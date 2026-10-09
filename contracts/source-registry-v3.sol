// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * SourceRegistry V3 candidate: revision-checked edits and creator-signed registration.
 *
 * A relayer may pay registration gas, but the signed creator retains the source ID
 * and exclusive edit authority. The contract holds no funds and has no admin role.
 * Existing V1/V2 registries are independent; this contract does not migrate them.
 * Signature recovery supports EOAs only; it does not implement EIP-1271.
 */
contract SourceRegistryV3 is EIP712 {
    struct AuthorSplit {
        address wallet;
        uint16 basisPoints;
    }

    struct SourceRecord {
        address creator;
        address payoutWallet;
        AuthorSplit[] authors;
        uint64 fetchPriceUsdc6;
        string contentCid;
        string tags;
        bool active;
    }

    struct RegistrationRequest {
        address creator;
        address relayer;
        bytes32 urlHash;
        address payoutWallet;
        AuthorSplit[] authors;
        uint64 fetchPriceUsdc6;
        string contentCid;
        string tags;
        uint256 nonce;
        uint64 deadline;
    }

    bytes32 private constant REGISTRATION_TYPEHASH = keccak256(
        "Registration(address creator,address relayer,bytes32 urlHash,address payoutWallet,bytes32 authorsHash,uint64 fetchPriceUsdc6,bytes32 contentCidHash,bytes32 tagsHash,uint256 nonce,uint64 deadline)"
    );
    uint256 private constant MAX_TAG_BYTES = 256;
    uint256 private constant MAX_CID_BYTES = 128;
    uint256 private constant MAX_AUTHORS = 20;

    mapping(bytes32 => SourceRecord) private _sources;
    mapping(bytes32 => uint64) public revisions;
    mapping(address => uint256) public registrationNonces;
    bytes32[] public sourceIds;

    event SourceRegistered(bytes32 indexed id, address indexed creator, string contentCid);
    event SourceUpdated(bytes32 indexed id, address indexed updater);
    event SourceDeactivated(bytes32 indexed id);

    error StaleRevision(uint64 expected, uint64 actual);
    error InactiveSource();
    error NotCreator();
    error AlreadyExists();
    error BadSplit();
    error StringTooLong();
    error ZeroAddress();
    error InvalidRelayer();
    error RegistrationExpired();
    error InvalidRegistrationNonce(uint256 expected, uint256 actual);
    error InvalidRegistrationSignature();

    constructor() EIP712("KeryxSourceRegistry", "3") {}

    modifier onlyCreator(bytes32 id) {
        if (_sources[id].creator != msg.sender) revert NotCreator();
        _;
    }

    modifier currentRevision(bytes32 id, uint64 expected) {
        if (revisions[id] != expected) revert StaleRevision(expected, revisions[id]);
        if (!_sources[id].active) revert InactiveSource();
        // A later validation failure rolls back this increment and every write.
        revisions[id] = expected + 1;
        _;
    }

    function registryVersion() external pure returns (uint8) { return 3; }

    /** Direct creator-paid registration retains the V1/V2 argument/event shape. */
    function register(
        bytes32 urlHash,
        address payoutWallet,
        AuthorSplit[] calldata authors,
        uint64 fetchPriceUsdc6,
        string calldata contentCid,
        string calldata tags
    ) external {
        _register(msg.sender, urlHash, payoutWallet, authors, fetchPriceUsdc6, contentCid, tags);
    }

    /**
     * Register exactly what the creator signed, through their named relayer.
     *
     * authorsHash = keccak256(abi.encode(authors)); string hashes use their UTF-8
     * bytes. The typed domain binds this chain and contract. Nonces are sequential
     * per creator and consumed only by successful signed registrations. A failed
     * transaction preserves its original nonce; direct registration consumes none.
     */
    function registerWithSignature(RegistrationRequest calldata request, bytes calldata signature) external {
        if (request.creator == address(0)) revert ZeroAddress();
        if (request.relayer != msg.sender) revert InvalidRelayer();
        if (block.timestamp > request.deadline) revert RegistrationExpired();
        uint256 expected = registrationNonces[request.creator];
        if (request.nonce != expected) revert InvalidRegistrationNonce(expected, request.nonce);

        address signer = ECDSA.recover(_hashTypedDataV4(_registrationHash(request)), signature);
        if (signer != request.creator) revert InvalidRegistrationSignature();

        registrationNonces[request.creator] = expected + 1;
        _register(
            request.creator, request.urlHash, request.payoutWallet, request.authors,
            request.fetchPriceUsdc6, request.contentCid, request.tags
        );
    }

    function update(
        bytes32 id,
        uint64 expectedRevision,
        address payoutWallet,
        AuthorSplit[] calldata authors,
        uint64 fetchPriceUsdc6,
        string calldata contentCid,
        string calldata tags
    ) external onlyCreator(id) currentRevision(id, expectedRevision) {
        if (payoutWallet == address(0)) revert ZeroAddress();
        _validateSplit(authors);
        _validateStrings(contentCid, tags);

        SourceRecord storage record = _sources[id];
        record.payoutWallet = payoutWallet;
        record.fetchPriceUsdc6 = fetchPriceUsdc6;
        record.contentCid = contentCid;
        record.tags = tags;
        delete record.authors;
        for (uint256 i; i < authors.length; ++i) record.authors.push(authors[i]);
        emit SourceUpdated(id, msg.sender);
    }

    function updatePrice(bytes32 id, uint64 expectedRevision, uint64 fetchPriceUsdc6)
        external onlyCreator(id) currentRevision(id, expectedRevision)
    {
        _sources[id].fetchPriceUsdc6 = fetchPriceUsdc6;
        emit SourceUpdated(id, msg.sender);
    }

    function deactivate(bytes32 id, uint64 expectedRevision)
        external onlyCreator(id) currentRevision(id, expectedRevision)
    {
        _sources[id].active = false;
        emit SourceDeactivated(id);
    }

    function get(bytes32 id) external view returns (SourceRecord memory) {
        return _sources[id];
    }

    function getWithRevision(bytes32 id) external view returns (SourceRecord memory record, uint64 revision) {
        return (_sources[id], revisions[id]);
    }

    function sourceCount() external view returns (uint256) {
        return sourceIds.length;
    }

    function _registrationHash(RegistrationRequest calldata request) private pure returns (bytes32) {
        return keccak256(abi.encode(
            REGISTRATION_TYPEHASH,
            request.creator,
            request.relayer,
            request.urlHash,
            request.payoutWallet,
            keccak256(abi.encode(request.authors)),
            request.fetchPriceUsdc6,
            keccak256(bytes(request.contentCid)),
            keccak256(bytes(request.tags)),
            request.nonce,
            request.deadline
        ));
    }

    function _register(
        address creator,
        bytes32 urlHash,
        address payoutWallet,
        AuthorSplit[] calldata authors,
        uint64 fetchPriceUsdc6,
        string calldata contentCid,
        string calldata tags
    ) private {
        if (payoutWallet == address(0)) revert ZeroAddress();
        bytes32 id = keccak256(abi.encode(creator, urlHash));
        if (_sources[id].creator != address(0)) revert AlreadyExists();
        _validateSplit(authors);
        _validateStrings(contentCid, tags);

        SourceRecord storage record = _sources[id];
        record.creator = creator;
        record.payoutWallet = payoutWallet;
        record.fetchPriceUsdc6 = fetchPriceUsdc6;
        record.contentCid = contentCid;
        record.tags = tags;
        record.active = true;
        for (uint256 i; i < authors.length; ++i) record.authors.push(authors[i]);

        sourceIds.push(id);
        revisions[id] = 1;
        emit SourceRegistered(id, creator, contentCid);
    }

    function _validateSplit(AuthorSplit[] calldata authors) private pure {
        if (authors.length == 0 || authors.length > MAX_AUTHORS) revert BadSplit();
        uint32 total;
        for (uint256 i; i < authors.length; ++i) {
            if (authors[i].wallet == address(0)) revert ZeroAddress();
            if (authors[i].basisPoints == 0) revert BadSplit();
            total += authors[i].basisPoints;
        }
        if (total != 10_000) revert BadSplit();
    }

    function _validateStrings(string calldata contentCid, string calldata tags) private pure {
        if (bytes(contentCid).length > MAX_CID_BYTES) revert StringTooLong();
        if (bytes(tags).length > MAX_TAG_BYTES) revert StringTooLong();
    }
}
