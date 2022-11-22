pragma solidity 0.8.9; //the AccessControlledOffchainAggregator actually uses ^0.7.1 but as this is an interface this is ok.

import "./TESTAccessControlledOffchainAggregator.sol";
contract TESTAggregatorV3 {

    TESTAccessControlledOffchainAggregator public aggregator;

    int192 price;
    uint256 staleTimestamp;

    constructor() {
        aggregator = new TESTAccessControlledOffchainAggregator();
        price = 110000000;
    }

    function decimals() external view returns(uint8){
        return(8);
    }

    function minPrice() external view returns(int192){
        return(1000000); //$0.01 in oracle scale
    }
        

    function maxPrice() external view returns(int192){
        return(100000000000); //$1000.00 in oracle scale
    }

    function setPrice(int192 _price) external{
        price = _price;
    }

    function setTimestamp(uint256 _timestamp) external{
        staleTimestamp = _timestamp;
    }

    function latestRoundData() external view returns(
        uint80,
        int, 
        uint256, 
        uint256, 
        uint80 ){

        uint256 updatedAt;
        if(staleTimestamp == 0){
            updatedAt = block.timestamp;
        }
        else{
            updatedAt = staleTimestamp;
        }
        return(
            0,
            price, //$1.1 in oracle scale
            block.timestamp -10, //round started at
            updatedAt, //updatedAt
            0
        );
    }
        
}
