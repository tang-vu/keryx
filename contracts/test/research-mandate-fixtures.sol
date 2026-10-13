// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ResearchMandateTestAgent {
    address public immutable signer;
    bool public refuseValidation;
    constructor(address signer_) { signer = signer_; }
    function setRefused(bool refused) external { require(msg.sender == signer); refuseValidation = refused; }
    function execute(address target, bytes calldata data) external {
        require(msg.sender == signer);
        (bool ok, bytes memory result) = target.call(data);
        if (!ok) assembly { revert(add(result, 32), mload(result)) }
    }
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        require(!refuseValidation, "Synthetic agent refuses");
        (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecover(hash, signature);
        return error == ECDSA.RecoverError.NoError && recovered == signer ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/// @dev Local synthetic token only. It is not Arc native USDC or vendor acceptance evidence.
contract ResearchMandateTestUSDC is ERC20, EIP712 {
    bool public failTransfers;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;
    bytes32 private constant TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    constructor() ERC20("Synthetic USDC", "sUSDC") EIP712("Synthetic USDC", "2") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setTransferFailure(bool next) external { failTransfers = next; }
    function transfer(address to, uint256 value) public override returns (bool) {
        return failTransfers ? false : super.transfer(to, value);
    }
    function DOMAIN_SEPARATOR() external view returns (bytes32) { return _domainSeparatorV4(); }
    function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter,
        uint256 validBefore, bytes32 nonce, bytes calldata signature) external {
        require(block.timestamp > validAfter && block.timestamp < validBefore, "authorization time");
        require(!authorizationState[from][nonce], "nonce used");
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(TYPEHASH, from, to, value, validAfter, validBefore, nonce)));
        if (from.code.length == 0) require(ECDSA.recover(digest, signature) == from, "invalid signature");
        else require(IERC1271(from).isValidSignature(digest, signature) == 0x1626ba7e, "invalid signature");
        authorizationState[from][nonce] = true;
        _transfer(from, to, value);
    }
}
