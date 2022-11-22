require("@nomicfoundation/hardhat-toolbox");
require("solidity-coverage");

require('dotenv').config()

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
 
module.exports = {
  solidity: "0.8.9",
  
  settings: {
	optimizer : {
		enabled: true,
		runs: 2000,
		details: {
			yul: true, 
			yulDetails: {
				stackAllocation: true,
			}
		}
	}
  },
  networks: {
	hardhat: {
		forking: {
		  url: process.env.OPTIMISM_MAINNET_API_AND_KEY,
		  blockNumber: 17997668, //14th August
		   
		}
	  },
	  
  	kovan: {
  		url: process.env.KOVAN_API_AND_KEY,
  		accounts: [ process.env.DEPLOYMENT_ACCOUNT ]
  		},
	optimism: {
		url: process.env.OPTIMISM_MAINNET_API_AND_KEY,
		accounts: [ process.env.DEPLOYMENT_ACCOUNT ]
			},
  	    
	optimism_kovan: {
		url: process.env.OPTIMISM_KOVAN_API_AND_KEY,
		accounts: [ process.env.DEPLOYMENT_ACCOUNT ]
				},
	optimism_goerli: {
		url: process.env.OPTIMISM_GOERLI_API_AND_KEY,
		accounts: [ process.env.DEPLOYMENT_ACCOUNT ]
					}
				}	,
  	    
};

