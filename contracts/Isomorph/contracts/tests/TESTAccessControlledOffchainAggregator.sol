pragma solidity 0.8.9; //the AccessControlledOffchainAggregator actually uses ^0.7.1 but as this is an interface this is ok.

contract TESTAccessControlledOffchainAggregator {

    function minAnswer() external returns(int192){
        return(1000000); //$0.01 in oracle scale
    }
        

    function maxAnswer() external returns(int192){
        return(100000000000); //$1000.00 in oracle scale
    }
        
}
