// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IMandateUSDC is IERC20 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
}

/// @notice An optional USDC purchasing authority for research. This is NOT a
/// Gateway depositor or a replacement for Keryx's existing funded EOA journals.
/// Caps count committed purchases, including exposed but unsettled intents.
/// Only verified USDC authorization consumption or a direct transfer is paid.
contract ResearchSpendingMandate is ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes4 private constant VALID_SIGNATURE = 0x1626ba7e;
    bytes4 private constant INVALID_SIGNATURE = 0xffffffff;
    bytes32 public constant TRANSFER_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    uint256 public constant MAX_PER_PAYMENT = 1_000_000 * 1e6;

    struct Limits {
        uint128 perPayment;
        uint128 daily;
        uint128 rollingWeek;
        uint128 lifetime;
        uint128 protectedReserve;
        uint64 expiresAt;
    }
    struct Purchase {
        bytes32 requestId;
        bytes32 taskHash;
        bytes32 sourceId;
        bytes32 contentHash;
        bytes32 decisionHash;
        bytes32 category;
        address payee;
        uint128 amount;
        uint64 validUntil;
    }
    enum State { None, Prepared, Paid, Released }
    struct Prepared {
        Purchase purchase;
        bytes32 binding;
        bytes32 nonce;
        uint64 epoch;
        uint64 day;
        uint64 preparedBlock;
        State state;
    }

    IMandateUSDC public immutable usdc;
    address public immutable owner;
    uint256 public immutable deploymentChainId;
    address public agent;
    Limits public limits;
    bool public paused;
    uint64 public epoch = 1;
    uint256 public committedTotal;
    uint256 public heldTotal;
    uint256 public settledTotal;
    mapping(uint256 => uint256) public committedByDay;
    mapping(bytes32 => uint256) public categoryLimit;
    mapping(bytes32 => uint256) public categoryCommitted;
    mapping(bytes32 => uint256) public taskLimit;
    mapping(bytes32 => uint256) public taskCommitted;
    mapping(address => bool) public allowedPayee;
    /// @notice Owner-reviewed source routing. A source hash alone does not prove ownership.
    mapping(bytes32 => address) public sourcePayee;
    mapping(bytes32 => Prepared) private originals;

    error OwnerOnly();
    error AgentOnly();
    error InvalidPolicy();
    error InvalidPurchase();
    error RequestConflict();
    error PolicyRefused();
    error NotPrepared();
    error DecisionNotPrior();
    error LiabilityUnresolved();

    event PolicyChanged(uint64 indexed epoch, address indexed agent);
    event PurchasePrepared(bytes32 indexed requestId, bytes32 indexed binding, bytes32 indexed decisionHash,
        address payee, uint256 amount, bytes32 nonce, uint64 epoch);
    event PurchasePaid(bytes32 indexed requestId, bytes32 indexed nonce, bool direct);
    event PurchaseReleased(bytes32 indexed requestId, bytes32 indexed nonce);
    event OwnerWithdrawal(address indexed payee, uint256 amount);

    modifier onlyOwner() { if (msg.sender != owner) revert OwnerOnly(); _; }
    modifier onlyAgent() { if (msg.sender != agent) revert AgentOnly(); _; }

    constructor(address token, address owner_, address agent_, Limits memory initialLimits) {
        if (token.code.length == 0 || owner_ == address(0) || IERC20Metadata(token).decimals() != 6) revert InvalidPolicy();
        usdc = IMandateUSDC(token);
        owner = owner_;
        deploymentChainId = block.chainid;
        _validateLimits(initialLimits);
        if (agent_ == address(0) || agent_ == address(this) || agent_ == owner_) revert InvalidPolicy();
        agent = agent_;
        limits = initialLimits;
    }

    function setPolicy(address agent_, Limits calldata next) external onlyOwner {
        _validateLimits(next);
        if (agent_ == address(0) || agent_ == address(this) || agent_ == owner) revert InvalidPolicy();
        agent = agent_;
        limits = next;
        _invalidate();
    }
    function setPayee(address payee, bool allowed) external onlyOwner {
        if (payee == address(0) || payee == address(this)) revert InvalidPolicy();
        allowedPayee[payee] = allowed;
        _invalidate();
    }
    function setCategory(bytes32 category, uint128 cap) external onlyOwner {
        if (category == bytes32(0)) revert InvalidPolicy();
        categoryLimit[category] = cap;
        _invalidate();
    }
    function setSource(bytes32 sourceId, address payee) external onlyOwner {
        if (sourceId == bytes32(0) || payee == address(this)) revert InvalidPolicy();
        sourcePayee[sourceId] = payee;
        _invalidate();
    }
    function setTask(bytes32 taskHash, uint128 cap) external onlyOwner {
        if (taskHash == bytes32(0)) revert InvalidPolicy();
        taskLimit[taskHash] = cap;
        _invalidate();
    }
    /// @notice Every pause/resume changes the epoch: an old signature never revives.
    function setPaused(bool next) external onlyOwner { paused = next; _invalidate(); }

    /// @notice Funding is an explicit owner action in ERC20 six-decimal units.
    function fund(uint256 amount) external onlyOwner nonReentrant {
        IERC20(address(usdc)).safeTransferFrom(owner, address(this), amount);
    }
    /// @notice Owner escape remains available even while paused or expired.
    function withdraw(address payee, uint256 amount) external onlyOwner nonReentrant {
        if (payee == address(0)) revert InvalidPolicy();
        IERC20(address(usdc)).safeTransfer(payee, amount);
        emit OwnerWithdrawal(payee, amount);
    }

    /// @notice The decision binding must be mined before either money path can run.
    /// Exact replay returns the original nonce; a changed tuple never creates a retry.
    function prepare(Purchase calldata purchase) external onlyAgent returns (bytes32 nonce) {
        bytes32 binding = keccak256(abi.encode(purchase));
        Prepared storage prior = originals[purchase.requestId];
        if (prior.state != State.None) {
            if (prior.binding != binding) revert RequestConflict();
            return prior.nonce;
        }
        _validatePurchase(purchase);
        uint256 day = block.timestamp / 1 days;
        if (committedByDay[day] + purchase.amount > limits.daily ||
            rollingCommitted() + purchase.amount > limits.rollingWeek ||
            committedTotal + purchase.amount > limits.lifetime ||
            categoryCommitted[purchase.category] + purchase.amount > categoryLimit[purchase.category] ||
            taskCommitted[purchase.taskHash] + purchase.amount > taskLimit[purchase.taskHash] ||
            usdc.balanceOf(address(this)) < uint256(limits.protectedReserve) + heldTotal + purchase.amount)
            revert PolicyRefused();
        nonce = keccak256(abi.encode(address(this), deploymentChainId, purchase.requestId, binding, epoch));
        if (usdc.authorizationState(address(this), nonce)) revert RequestConflict();
        originals[purchase.requestId] = Prepared(purchase, binding, nonce, epoch, uint64(day), uint64(block.number), State.Prepared);
        committedByDay[day] += purchase.amount;
        committedTotal += purchase.amount;
        heldTotal += purchase.amount;
        categoryCommitted[purchase.category] += purchase.amount;
        taskCommitted[purchase.taskHash] += purchase.amount;
        emit PurchasePrepared(purchase.requestId, binding, purchase.decisionHash, purchase.payee, purchase.amount, nonce, epoch);
    }

    /// @notice Direct transfers and EIP3009 share one original, one nonce and one held allocation.
    function pay(bytes32 requestId) external onlyAgent nonReentrant {
        Prepared storage original = originals[requestId];
        if (!_executable(original) || usdc.authorizationState(address(this), original.nonce)) revert PolicyRefused();
        if (block.number <= original.preparedBlock) revert DecisionNotPrior();
        original.state = State.Paid;
        heldTotal -= original.purchase.amount;
        settledTotal += original.purchase.amount;
        IERC20(address(usdc)).safeTransfer(original.purchase.payee, original.purchase.amount);
        emit PurchasePaid(requestId, original.nonce, true);
    }

    /// @notice EIP1271 validates ONLY the exact USDC transfer of a prior committed decision.
    /// Envelope: abi.encode(requestId, agentSignatureOverUSDCTransferDigest).
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        try this.decodeEnvelope(signature) returns (bytes32 requestId, bytes memory agentSignature) {
            Prepared storage original = originals[requestId];
            if (!_executable(original) || block.number <= original.preparedBlock ||
                usdc.authorizationState(address(this), original.nonce) || transferDigest(requestId) != hash)
                return INVALID_SIGNATURE;
            return _agentSigned(hash, agentSignature) ? VALID_SIGNATURE : INVALID_SIGNATURE;
        } catch { return INVALID_SIGNATURE; }
    }
    function decodeEnvelope(bytes calldata signature) external pure returns (bytes32, bytes memory) {
        return abi.decode(signature, (bytes32, bytes));
    }
    function transferDigest(bytes32 requestId) public view returns (bytes32) {
        Prepared storage original = originals[requestId];
        bytes32 transferHash = keccak256(abi.encode(TRANSFER_TYPEHASH, address(this), original.purchase.payee,
            uint256(original.purchase.amount), uint256(0), uint256(original.purchase.validUntil), original.nonce));
        return keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), transferHash));
    }

    /// @notice A public read/reconciliation operation clears only an actually consumed liability.
    /// The commitment still counts against every spending cap after settlement.
    function sync(bytes32 requestId) external {
        Prepared storage original = originals[requestId];
        if (original.state != State.Prepared) revert NotPrepared();
        if (!usdc.authorizationState(address(this), original.nonce)) revert LiabilityUnresolved();
        original.state = State.Paid;
        heldTotal -= original.purchase.amount;
        settledTotal += original.purchase.amount;
        emit PurchasePaid(requestId, original.nonce, false);
    }

    /// @notice Release only when this contract and USDC can no longer honor the original.
    /// This is on-chain EIP3009 expiry proof, NOT a Gateway timeout/absence rule.
    function release(bytes32 requestId) external onlyOwner {
        Prepared storage original = originals[requestId];
        if (original.state != State.Prepared) revert NotPrepared();
        if (usdc.authorizationState(address(this), original.nonce)) revert LiabilityUnresolved();
        if (!paused && original.epoch == epoch && block.timestamp <= original.purchase.validUntil)
            revert LiabilityUnresolved();
        original.state = State.Released;
        heldTotal -= original.purchase.amount;
        committedTotal -= original.purchase.amount;
        committedByDay[original.day] -= original.purchase.amount;
        categoryCommitted[original.purchase.category] -= original.purchase.amount;
        taskCommitted[original.purchase.taskHash] -= original.purchase.amount;
        emit PurchaseReleased(requestId, original.nonce);
    }

    function getOriginal(bytes32 requestId) external view returns (Prepared memory) { return originals[requestId]; }
    function rollingCommitted() public view returns (uint256 total) {
        uint256 day = block.timestamp / 1 days;
        // Eight UTC buckets conservatively cover every purchase in the previous
        // 168 hours. Seven calendar buckets could drop a late-day purchase early.
        // This can refuse capacity for up to an extra day; it cannot undercount.
        for (uint256 i; i < 8 && i <= day; ++i) total += committedByDay[day - i];
    }
    function _executable(Prepared storage original_) private view returns (bool) {
        return original_.state == State.Prepared && !paused && original_.epoch == epoch &&
            block.chainid == deploymentChainId && block.timestamp < limits.expiresAt &&
            block.timestamp < original_.purchase.validUntil && allowedPayee[original_.purchase.payee] &&
            usdc.balanceOf(address(this)) >= uint256(limits.protectedReserve) + heldTotal;
    }
    function _validatePurchase(Purchase calldata purchase) private view {
        if (paused || block.timestamp >= limits.expiresAt || block.chainid != deploymentChainId ||
            purchase.requestId == bytes32(0) || purchase.taskHash == bytes32(0) || purchase.sourceId == bytes32(0) ||
            purchase.contentHash == bytes32(0) || purchase.decisionHash == bytes32(0) || purchase.category == bytes32(0) ||
            purchase.amount == 0 || purchase.amount > limits.perPayment || !allowedPayee[purchase.payee] ||
            sourcePayee[purchase.sourceId] != purchase.payee ||
            purchase.payee == address(this) || purchase.validUntil <= block.timestamp ||
            purchase.validUntil > limits.expiresAt || purchase.validUntil >= ((block.timestamp / 1 days) + 1) * 1 days ||
            categoryLimit[purchase.category] == 0 || taskLimit[purchase.taskHash] == 0)
            revert InvalidPurchase();
    }
    function _validateLimits(Limits memory next) private view {
        if (next.perPayment == 0 || next.perPayment > MAX_PER_PAYMENT || next.daily < next.perPayment ||
            next.rollingWeek < next.daily || next.lifetime < next.rollingWeek ||
            next.expiresAt <= block.timestamp || next.expiresAt > block.timestamp + 365 days) revert InvalidPolicy();
    }
    /// @dev EOA (including EIP7702) first, then an owner's chosen EIP1271 agent.
    /// Avoid SignatureChecker's newer MCOPY dependency on the repository's Paris target.
    function _agentSigned(bytes32 hash, bytes memory signature) private view returns (bool) {
        (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecover(hash, signature);
        if (error == ECDSA.RecoverError.NoError && recovered == agent) return true;
        if (agent.code.length == 0) return false;
        (bool success, bytes memory result) = agent.staticcall(abi.encodeCall(IERC1271.isValidSignature, (hash, signature)));
        return success && result.length >= 32 && bytes4(result) == VALID_SIGNATURE;
    }
    function _invalidate() private { ++epoch; emit PolicyChanged(epoch, agent); }
}
