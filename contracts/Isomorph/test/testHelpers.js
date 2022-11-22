const { network } = require("hardhat");

/* Format for translation
async function snapshot(provider) {
    const snapshot = await network.provider.request({method: 'evm_snapshot', params : []});
    return(snapshot);
  }
*/
const snapshot = async (provider) => {
    const snapshot = await network.provider.request({method: 'evm_snapshot', params : []});
    return(snapshot);
};

const revertChainSnapshot = async (provider, Id) => network.provider.request({
    method: 'evm_revert', params : [Id]
    });
  
  //functions borrowed from synthetix test utils
const mineBlock = () => network.provider.request({
    method: "evm_mine"
  });

const timeSkip = async (seconds) => network.provider.request({
    method: "evm_increaseTime",
    params: [seconds],
  });

//overwrite storage slot, example inputs:
//address: "0x0d2026b3EE6eC71FC6746ADb6311F6d3Ba1C000B",
//position: "0x0",
//data: "0x0000000000000000000000000000000000000000000000000000000000000001",
const overwriteStorage = async (address, position, data) => network.provider.send("hardhat_setStorageAt", [
  address,
  position,
  data,
]);

helpers = { timeSkip: timeSkip,
            snapshot: snapshot,
            revertChainSnapshot: revertChainSnapshot,
            mineBlock : mineBlock,
            overwriteStorage: overwriteStorage }
module.exports = { helpers }