pragma solidity =0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract TESTRouterETH {
    address WETH = 0x4200000000000000000000000000000000000006;

    function addLiquidity() external{
        //dumbie to get a vAMM or sAMM test token
    }

    function quoteRemoveLiquidity(address tokenA, address tokenB, bool stable, uint256 liquidity) external view returns(uint256 amountA, uint256 amountB){
        //return different values to make unit test error detection easier
        bytes memory WETHSymbol = abi.encodePacked("WETH");
        bytes memory tokenASymbol = abi.encodePacked(IERC20Metadata(tokenA).symbol());
        //equality cannot be checked for strings so we hash them first.
        if (keccak256(tokenASymbol) == keccak256(WETHSymbol)){
            return(liquidity, (liquidity *11) /10); 
        }
        else{
            return((liquidity *11) /10, liquidity); 
        }
    }

    function getAmountOut(uint256 amountIn, address tokenIn, address tokenOut) external view returns(uint256 amount, bool stable){
        //return different values to make unit test error detection easier
        bytes memory WETHSymbol = abi.encodePacked("WETH");
        bytes memory tokenASymbol = abi.encodePacked(IERC20Metadata(tokenIn).symbol());
        //equality cannot be checked for strings so we hash them first.
        if (keccak256(tokenASymbol) == keccak256(WETHSymbol)){
            return((amountIn *12/11*10), true); //return 1.5x amountIn
        }
        else{
            return((amountIn/12*11/10) , true); //return 0.6x amountIn
        }
    } 
}