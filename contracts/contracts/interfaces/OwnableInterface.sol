// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

//borrowed from Chainlink
//https://github.com/smartcontractkit/chainlink/blob/develop/contracts/src/v0.8/interfaces/OwnableInterface.sol
interface OwnableInterface {
  function owner() external returns (address);

  function transferOwnership(address recipient) external;

  function acceptOwnership() external;
}