pragma solidity =0.8.9;

import "../CollateralBook.sol";
//*************************************
//TEST CODE ONLY DO NOT USE ON MAINNET 
//*************************************
contract TESTCollateralBook is CollateralBook {
    
    //This test contract makes testing some of the functionality of liquidation easier by allowing us to falsify the liquidation return figure for easier setup.
    //If this function is NOT explicitly needed default to using the proper changeCollateralType function of CollateralBook.
    function TESTchangeCollateralType(
        address _collateralAddress,
        bytes32 _currencyKey,
        uint256 _minimumRatio,
        uint256 _liquidationRatio,
        uint256 _interestPer3Min,
        address _liquidityPool,
        uint256 _liquidation_return, 
        uint256 _assetType
        ) external collateralExists(_collateralAddress) onlyAdmin {
        require(_collateralAddress != address(0));
        require(_minimumRatio > _liquidationRatio);
        require(_liquidationRatio != 0);
        require(vaults[_assetType] != address(0), "Vault not deployed yet");
        //prevent setting liquidationRatio too low ssuch that it would cause an overflow in callLiquidation, see appendix on liquidation maths for details.
        require( _liquidation_return *_liquidationRatio >= 10 ** 36, "Liquidation ratio too low"); //i.e. 1 when multiplying two 1 ether scale numbers.
        //Now we must ensure interestPer3Min changes aren't applied retroactively
        // by updating the assets virtualPrice to current block timestamp
        uint256 timeDelta = (block.timestamp - collateralProps[_collateralAddress].lastUpdateTime) / THREE_MIN;
        if (timeDelta != 0){ 
           updateVirtualPriceSlowly(_collateralAddress, timeDelta );
        }
        _changeCollateralParameters(
            _collateralAddress,
            _currencyKey,
            _minimumRatio,
            _liquidationRatio,
            _interestPer3Min
        );
        //Then update LiqPool as this isn't stored in the struct and requires the currencyKey also.
        liquidityPoolOf[_currencyKey]= _liquidityPool; 

        
    }

}