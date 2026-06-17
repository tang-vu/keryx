// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * SourceRegistry — on-chain source catalog for Keryx.
 *
 * Stores content source metadata: creator, payout wallet, multi-author basis-point splits,
 * fetch price (USDC 6-decimals), IPFS content CID, and tags. Creator-only edit access.
 * No funds held — no reentrancy surface. No OpenZeppelin dependency (KISS/testnet).
 *
 * Source IDs: bytes32 = keccak256(abi.encode(msg.sender, urlHash))
 *   where urlHash = keccak256(toBytes(canonicalUrl)) — computed off-chain by the client.
 *   Binding the ID to msg.sender makes squatting impossible: an attacker registering
 *   someone else's URL gets a different ID and cannot hijack the real creator's payout.
 *
 * Basis-point splits: author shares must sum to exactly 10_000 (= 100%). Stored as uint16;
 * off-chain consumers derive splitWeight = basisPoints / 10_000 (float) when mapping to cache.
 */
contract SourceRegistry {
    struct AuthorSplit {
        address wallet;
        uint16  basisPoints; // author's share; all authors for one source must sum to 10_000
    }

    struct SourceRecord {
        address       creator;          // registered this source; only they may update/deactivate
        address       payoutWallet;     // primary settlement address for fetch tolls
        AuthorSplit[] authors;          // weighted citation split (sum of basisPoints = 10_000)
        uint64        fetchPriceUsdc6;  // per-fetch toll in USDC 6-decimal units (100 = $0.0001)
        string        contentCid;       // IPFS CID (or URL) pointing to gated content; lazy-fetched
        string        tags;             // comma-separated topic tags for off-chain filtering
        bool          active;
    }

    mapping(bytes32 => SourceRecord) private _sources;
    bytes32[] public sourceIds; // enumeration array — used by the off-chain indexer for backfill

    // Tag and CID string length caps defend against DoS via huge calldata.
    uint256 private constant MAX_TAG_BYTES  = 256;
    uint256 private constant MAX_CID_BYTES  = 128;
    uint256 private constant MAX_AUTHORS    = 20;

    event SourceRegistered(bytes32 indexed id, address indexed creator, string contentCid);
    event SourceUpdated(bytes32 indexed id, address indexed updater);
    event SourceDeactivated(bytes32 indexed id);

    error NotCreator();
    error AlreadyExists();
    error BadSplit();          // author basisPoints don't sum to 10_000, zero-bp author, or too many authors
    error StringTooLong();     // contentCid or tags exceed length caps
    error ZeroAddress();       // payoutWallet or author wallet is the zero address

    modifier onlyCreator(bytes32 id) {
        if (_sources[id].creator != msg.sender) revert NotCreator();
        _;
    }

    /**
     * Register a new source. The ID is derived on-chain as keccak256(abi.encode(msg.sender, urlHash))
     * where urlHash = keccak256(toBytes(canonicalUrl)) supplied by the client. This binds the ID to
     * the caller's address, making front-running / URL squatting impossible — a different caller
     * derives a different ID for the same URL and cannot hijack the real creator's payout.
     *
     * @param urlHash   keccak256(toBytes(canonicalUrl)) — computed off-chain by the client
     * @param payoutWallet  Primary settlement address (must be non-zero)
     * @param authors   Weighted citation split (must sum to 10_000 bp; each author wallet non-zero; each bp > 0)
     * @param fetchPriceUsdc6  Per-fetch toll in USDC-6 atomic units
     * @param contentCid  IPFS CID for gated content (max 128 bytes)
     * @param tags  Comma-separated topic tags (max 256 bytes)
     */
    function register(
        bytes32          urlHash,
        address          payoutWallet,
        AuthorSplit[] calldata authors,
        uint64           fetchPriceUsdc6,
        string calldata  contentCid,
        string calldata  tags
    ) external {
        if (payoutWallet == address(0)) revert ZeroAddress();
        // Derive id from caller + urlHash — squatting impossible (C1 fix).
        bytes32 id = keccak256(abi.encode(msg.sender, urlHash));
        if (_sources[id].creator != address(0)) revert AlreadyExists();
        _validateSplit(authors);
        _validateStrings(contentCid, tags);

        SourceRecord storage r = _sources[id];
        r.creator         = msg.sender;
        r.payoutWallet    = payoutWallet;
        r.fetchPriceUsdc6 = fetchPriceUsdc6;
        r.contentCid      = contentCid;
        r.tags            = tags;
        r.active          = true;
        for (uint256 i; i < authors.length; ++i) r.authors.push(authors[i]);

        sourceIds.push(id);
        emit SourceRegistered(id, msg.sender, contentCid);
    }

    function update(
        bytes32          id,
        address          payoutWallet,
        AuthorSplit[] calldata authors,
        uint64           fetchPriceUsdc6,
        string calldata  contentCid,
        string calldata  tags
    ) external onlyCreator(id) {
        if (payoutWallet == address(0)) revert ZeroAddress();
        _validateSplit(authors);
        _validateStrings(contentCid, tags);

        SourceRecord storage r = _sources[id];
        r.payoutWallet    = payoutWallet;
        r.fetchPriceUsdc6 = fetchPriceUsdc6;
        r.contentCid      = contentCid;
        r.tags            = tags;
        // Replace author array — storage array must be deleted before re-pushing.
        delete r.authors;
        for (uint256 i; i < authors.length; ++i) r.authors.push(authors[i]);

        emit SourceUpdated(id, msg.sender);
    }

    function deactivate(bytes32 id) external onlyCreator(id) {
        _sources[id].active = false;
        emit SourceDeactivated(id);
    }

    function get(bytes32 id) external view returns (SourceRecord memory) {
        return _sources[id];
    }

    function sourceCount() external view returns (uint256) {
        return sourceIds.length;
    }

    // ── internal validators ──────────────────────────────────────────────────

    function _validateSplit(AuthorSplit[] calldata authors) private pure {
        if (authors.length > MAX_AUTHORS) revert BadSplit();
        // At least one author is required; a zero-author source uses payoutWallet as 100%.
        if (authors.length == 0) revert BadSplit();
        uint32 total;
        for (uint256 i; i < authors.length; ++i) {
            if (authors[i].wallet == address(0)) revert ZeroAddress();
            if (authors[i].basisPoints == 0) revert BadSplit(); // zero-bp author is meaningless
            total += authors[i].basisPoints;
        }
        if (total != 10_000) revert BadSplit();
    }

    function _validateStrings(string calldata contentCid, string calldata tags) private pure {
        if (bytes(contentCid).length > MAX_CID_BYTES) revert StringTooLong();
        if (bytes(tags).length > MAX_TAG_BYTES) revert StringTooLong();
    }
}
