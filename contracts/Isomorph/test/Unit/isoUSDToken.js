const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants");
const { helpers } = require("../testHelpers.js")

const TIME_DELAY = 3 * 24 *60 *60 +1 //3 days + 1s
const MINTER = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"));

describe("Unit tests: isoUSD contract", function () {
    let snapshotId;
    const provider = ethers.provider;
    before(async function () {
        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
        isoUSDcontract = await ethers.getContractFactory("isoUSDToken");
        let amount = ethers.utils.parseEther('10'); 
        isoUSD = await isoUSDcontract.deploy();
    });

    beforeEach(async () => {
        snapshotId = await helpers.snapshot(provider);
        //console.log('Snapshotted at ', await provider.getBlockNumber());
      });
    
      afterEach(async () => {
        await helpers.revertChainSnapshot(provider, snapshotId);
        //console.log('Reset block heigh to ', await provider.getBlockNumber());
      });

    describe("Constructor", function () {
        it("should not set anyone as DEFAULT_ADMIN_ROLE", async function() {
            const default_admin = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("DEFAULT_ADMIN_ROLE"));
            expect( await isoUSD.hasRole(default_admin, owner.address) ).to.equal(false);        
        });
        it("should set deploying address as weaker ADMIN_ROLE", async function() {
            const weaker_admin = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ADMIN_ROLE"));
            expect( await isoUSD.hasRole(weaker_admin, owner.address) ).to.equal(true);        
        });
    })

    describe("addMinter", function () {
        beforeEach(async function (){
            const tx = await isoUSD.connect(owner).proposeAddRole(addr2.address, MINTER);
            const block = await ethers.provider.getBlock(tx.blockNumber);
            await expect(tx).to.emit(isoUSD, 'QueueAddRole').withArgs(addr2.address, MINTER, owner.address, block.timestamp);

        })
        it("should add a minter if following correct procedure", async function() {
            await helpers.timeSkip(TIME_DELAY);
            await expect(isoUSD.connect(owner).addRole(addr2.address, MINTER)).to.emit(isoUSD, 'AddRole').withArgs(addr2.address, MINTER,  owner.address);
            expect( await isoUSD.hasRole(MINTER, addr2.address) ).to.equal(true);
        });

        it("should be possible to add, remove then add the same minter again", async function() {
            await helpers.timeSkip(TIME_DELAY);
            await expect(isoUSD.connect(owner).addRole(addr2.address, MINTER)).to.emit(isoUSD, 'AddRole').withArgs(addr2.address, MINTER, owner.address);
            expect( await isoUSD.hasRole(MINTER, addr2.address) ).to.equal(true);
            await expect(isoUSD.connect(owner).removeRole(addr2.address, MINTER)).to.emit(isoUSD, 'RemoveRole').withArgs(addr2.address, MINTER, owner.address);
            expect( await isoUSD.hasRole(MINTER, addr2.address) ).to.equal(false);
            const tx = await isoUSD.connect(owner).proposeAddRole(addr2.address, MINTER);
            const block = await ethers.provider.getBlock(tx.blockNumber);
            await expect(tx).to.emit(isoUSD, 'QueueAddRole').withArgs(addr2.address, MINTER, owner.address, block.timestamp);
            await helpers.timeSkip(TIME_DELAY);
            await expect(isoUSD.connect(owner).addRole(addr2.address, MINTER)).to.emit(isoUSD, 'AddRole').withArgs(addr2.address, MINTER, owner.address);
            expect( await isoUSD.hasRole(MINTER, addr2.address) ).to.equal(true);
        });

        it("should fail to remove a non-existent minter", async function() {
            await expect(isoUSD.connect(owner).removeRole(addr2.address, MINTER)).to.be.revertedWith("Address was not already specified role");
            

        });

        it("should fail to add a minter if a non-admin tries to complete adding", async function() {
            await helpers.timeSkip(TIME_DELAY);
            await expect(isoUSD.connect(addr1).addRole(addr2.address, MINTER)).to.be.revertedWith("Caller is not an admin");

        });

        it("should fail to queue multiple minters at the same time", async function() {
            const tx = await isoUSD.connect(owner).proposeAddRole(addr1.address, MINTER);
            const block = await ethers.provider.getBlock(tx.blockNumber);
            await expect(tx).to.emit(isoUSD, 'QueueAddRole').withArgs(addr1.address, MINTER, owner.address, block.timestamp);
            await helpers.timeSkip(TIME_DELAY);
            await expect(isoUSD.connect(owner).addRole(addr2.address, MINTER)).to.be.revertedWith("Invalid Hash");
            await expect(isoUSD.connect(owner).addRole(addr1.address, MINTER)).to.emit(isoUSD, 'AddRole').withArgs(addr1.address, MINTER, owner.address);
            expect( await isoUSD.hasRole(MINTER, addr2.address) ).to.equal(false);
            expect( await isoUSD.hasRole(MINTER, addr1.address) ).to.equal(true);

        });

        it("should succeed to to a add minter if nonce has been incremented (i.e. repeat transaction)", async function() {
            const tx = await isoUSD.connect(owner).proposeAddRole(addr2.address, MINTER);
            const block = await ethers.provider.getBlock(tx.blockNumber);
            await expect(tx).to.emit(isoUSD, 'QueueAddRole').withArgs(addr2.address, MINTER, owner.address, block.timestamp);
            await expect(isoUSD.connect(owner).addRole(addr2.address, MINTER)).to.be.revertedWith("Not enough time has passed");
            await helpers.timeSkip(TIME_DELAY);
            await expect(isoUSD.connect(owner).addRole(addr2.address, MINTER)).to.emit(isoUSD, 'AddRole').withArgs(addr2.address,MINTER,  owner.address);

        });

        it("should succeed to add multiple minters sequentially with required time delays", async function() {
            await helpers.timeSkip(TIME_DELAY);
            await expect(isoUSD.connect(owner).addRole(addr2.address, MINTER)).to.emit(isoUSD, 'AddRole').withArgs(addr2.address, MINTER, owner.address);
            expect( await isoUSD.hasRole(MINTER, addr2.address) ).to.equal(true);
            const tx = await isoUSD.connect(owner).proposeAddRole(addr1.address, MINTER);
            const block = await ethers.provider.getBlock(tx.blockNumber);
            await expect(tx).to.emit(isoUSD, 'QueueAddRole').withArgs(addr1.address, MINTER, owner.address, block.timestamp);
            expect( await isoUSD.hasRole(MINTER, addr1.address) ).to.equal(false);
            await helpers.timeSkip(TIME_DELAY);
            await expect(isoUSD.connect(owner).addRole(addr1.address, MINTER)).to.emit(isoUSD, 'AddRole').withArgs(addr1.address, MINTER, owner.address);
            expect( await isoUSD.hasRole(MINTER, addr1.address) ).to.equal(true);
        });

    });

    describe("Minting and burning roles", function () {
        beforeEach(async function (){
            const tx = await isoUSD.connect(owner).proposeAddRole(addr2.address, MINTER);
            const block = await ethers.provider.getBlock(tx.blockNumber);
            await expect(tx).to.emit(isoUSD, 'QueueAddRole').withArgs(addr2.address,MINTER, owner.address, block.timestamp);
            await helpers.timeSkip(TIME_DELAY);
            await expect(isoUSD.connect(owner).addRole(addr2.address, MINTER)).to.emit(isoUSD, 'AddRole').withArgs(addr2.address,MINTER, owner.address);
            expect( await isoUSD.hasRole(MINTER, addr2.address) ).to.equal(true);
        })
        it("should allow a minter to mint and burn", async function() {
            const amount = 10000;
            const beforeisoUSD = await isoUSD.balanceOf(addr2.address);
            expect(beforeisoUSD).to.equal(0);
            await isoUSD.connect(addr2).mint( amount);
            const afterisoUSD = await isoUSD.balanceOf(addr2.address);
            expect(afterisoUSD).to.equal(beforeisoUSD + amount);
            await isoUSD.connect(addr2).burn(addr2.address, amount);
            const finalisoUSD = await isoUSD.balanceOf(addr2.address);
            expect(finalisoUSD).to.equal(beforeisoUSD);

        });

        it("should revert if a minter tries to burn non-existent isoUSD", async function() {
            const amount = 10000;
            const beforeisoUSD = await isoUSD.balanceOf(addr1.address);
            expect(beforeisoUSD).to.equal(0);
            await expect(isoUSD.connect(addr2).burn(addr1.address, amount)).to.be.revertedWith("ERC20: burn amount exceeds balance");
            const finalisoUSD = await isoUSD.balanceOf(addr1.address);
            expect(finalisoUSD).to.equal(beforeisoUSD);

        });

        it("should revert if a minter tries to burn from zero address", async function() {
            const amount = 10000;
            const beforeisoUSD = await isoUSD.balanceOf(ZERO_ADDRESS);
            expect(beforeisoUSD).to.equal(0);
            await expect(isoUSD.connect(addr2).burn(ZERO_ADDRESS, amount)).to.be.revertedWith("ERC20: burn from the zero address");
            const finalisoUSD = await isoUSD.balanceOf(ZERO_ADDRESS);
            expect(finalisoUSD).to.equal(beforeisoUSD);

        });

        it("should revert if a non-minter tries to burn or mint", async function() {
            const amount = 10000;
            expect( await isoUSD.hasRole(MINTER, addr1.address) ).to.equal(false);
            await expect(isoUSD.connect(addr1).mint( amount)).to.be.revertedWith("Caller is not a minter");
            await expect(isoUSD.connect(addr1).burn(addr2.address, amount)).to.be.revertedWith("Caller is not a minter");
           

        });


    });

});
