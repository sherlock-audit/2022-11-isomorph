pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

interface IAggregatorV3 is AggregatorV3Interface {
    function aggregator() external view returns(address);
}