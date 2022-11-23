pragma solidity =0.8.9;


contract TESTVoter{

    address gauge;

    constructor (address _gauge){
        gauge = _gauge;
    }
    function gauges(address _pool) external returns(address){
        return gauge;
    }   

}