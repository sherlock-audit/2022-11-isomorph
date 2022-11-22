pragma solidity 0.8.9; //the AccessControlledOffchainAggregator actually uses ^0.7.1 but as this is an interface this is ok.

interface IAccessControlledOffchainAggregator {

    function minAnswer() external returns(int192);

    function maxAnswer() external returns(int192);
}
