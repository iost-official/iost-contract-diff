const path = require("path");
const fs = require("fs");
const process = require("process");
const axios = require("axios");
const printDiff = require("print-diff");

function getGoIostPath() {
  const projectRoot =
    process.env.GOIOST ||
    path.join(process.env.GOPATH, "src/github.com/iost-official/go-iost");
  return projectRoot;
}

function normalizeAbis(abis) {
  function fixAmountLimit(amount) {
    amount.val = amount.value;
    delete amount.value;
    return amount;
  }
  function fixAbi(abi) {
    abi.amountLimit = abi.amount_limit.map(fixAmountLimit);
    delete abi.amount_limit;
    return abi;
  }
  return abis.map(fixAbi);
}

function getRawLocalContract(contractPath) {
  const code = fs.readFileSync(contractPath, "utf8");
  const abi = JSON.parse(fs.readFileSync(contractPath + ".abi", "utf8")).abi;
  return { code, abi };
}

function getLocalContract(contractFile, needCompile) {
  const { code: originalCode, abi } = getRawLocalContract(contractFile);
  if (!needCompile) {
    return { originalCode, abi };
  }
  const compileFn = getCompileFunction();
  const compiledCode = compileFn(originalCode);
  return { originalCode, compiledCode, abi };
  function getCompileFunction() {
    const requireFromString = require("require-from-string");
    const projectRoot = getGoIostPath();
    const moduleName = path.join(projectRoot, "vm/v8vm/v8/libjs/inject_gas.js");
    const content = fs.readFileSync(moduleName, "utf8");

    const script = `
const escodegen = require('escodegen');
const esprima = require('esprima');
${content}
`;
    const injectGasFunction = requireFromString(script);
    return injectGasFunction;
  }
}

async function getOnchainContract(contractId) {
  const onchainContract = (
    await axios.get(`https://api.iost.io/getContract/${contractId}/true`)
  ).data;
  return {
    compiledCode: onchainContract.code,
    originalCode: onchainContract.originalCode,
    lang: onchainContract.language,
    version: onchainContract.version,
    abi: normalizeAbis(onchainContract.abis)
  };
}

async function printOnchainAbi(contract) {
  const onchainContract = await getOnchainContract(contract);
  const abi = {
    lang: onchainContract.lang,
    version: onchainContract.version,
    abi: onchainContract.abi
  };
  console.log(JSON.stringify(abi, null, 4));
}

async function compareContract(contractId, contractFile) {
  const onchainContract = await getOnchainContract(contractId);
  const hasOriginalCode = onchainContract.originalCode != null;
  const needCompile = !hasOriginalCode;
  const localContract = getLocalContract(contractFile, needCompile);
  console.log("diff of code:");
  if (hasOriginalCode) {
    printDiff(onchainContract.originalCode, localContract.originalCode);
  } else {
    printDiff(onchainContract.compiledCode, localContract.compiledCode);
  }
  console.log("diff of abi:");
  const toString = j => JSON.stringify(j, null, 4);
  printDiff(toString(onchainContract.abi), toString(localContract.abi));
}

async function main() {
  const contractId = process.argv[2];
  const contractFile = process.argv[3];
  if (contractId == null || contractFile == null) {
    const fileName = __filename.split("/").pop();
    console.log(`
usage: node ${fileName} contract-id contract-file
example: node ${fileName} ram.iost ../go-iost/config/genesis/contract/ram.js 
`);
    process.exit(1);
  }
  await compareContract(contractId, contractFile);
  //await printOnchainAbi(contractId);
}

main().catch(console.log);
