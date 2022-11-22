pragma solidity =0.8.9;

import "../helper/DepositReceipt.sol";


contract TESTDepositReceipt is  DepositReceipt {
    
    constructor(string memory _name, 
                string memory _symbol, 
                address _router, 
                address _token0,
                address _token1,
                bool _stable,
                address _priceFeed) 
                DepositReceipt(_name, _symbol, _router, _token0, _token1, _stable, _priceFeed){

    }

    /**
      * @dev UNSAFE MINTING only for dev testing!
      * @param _pooledTokenAmount amount of pooled tokens to be associated with NFT
     **/
    function UNSAFEMint( uint _pooledTokenAmount) external returns(uint256){
        return (_mintNewNFT(_pooledTokenAmount));
    }

}
