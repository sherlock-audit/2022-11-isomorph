pragma solidity 0.8.9;

interface IDepositReceipt {

    function priceLiquidity(uint256 pooledTokens) external view returns(uint256 value);

    function pooledTokens(uint256 NFTid) external view returns(uint256 pooledTokens);

    function transferFrom(address from, address to, uint256 tokenId) external ;

    function safeTransferFrom(address from, address to, uint256 tokenId) external;

    function ownerOf(uint256 tokenId) external view returns(address owner);

    function split(uint256 NFTId, uint256 percentageSplit) external returns (uint256 newNFTId);




}