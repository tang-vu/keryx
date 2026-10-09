/** Pure SourceRegistry ABI shared by server clients and keyless authority readers. */
export const REGISTRY_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "urlHash", type: "bytes32" },       // keccak256(toBytes(canonicalUrl))
      { name: "payoutWallet", type: "address" },
      {
        name: "authors",
        type: "tuple[]",
        components: [
          { name: "wallet", type: "address" },
          { name: "basisPoints", type: "uint16" },
        ],
      },
      { name: "fetchPriceUsdc6", type: "uint64" },
      { name: "contentCid", type: "string" },
      { name: "tags", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "update",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "payoutWallet", type: "address" },
      {
        name: "authors",
        type: "tuple[]",
        components: [
          { name: "wallet", type: "address" },
          { name: "basisPoints", type: "uint16" },
        ],
      },
      { name: "fetchPriceUsdc6", type: "uint64" },
      { name: "contentCid", type: "string" },
      { name: "tags", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "deactivate",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "get",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "payoutWallet", type: "address" },
          {
            name: "authors",
            type: "tuple[]",
            components: [
              { name: "wallet", type: "address" },
              { name: "basisPoints", type: "uint16" },
            ],
          },
          { name: "fetchPriceUsdc6", type: "uint64" },
          { name: "contentCid", type: "string" },
          { name: "tags", type: "string" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
  {
    name: "sourceCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    // Public enumeration array — sourceIds(i) returns the i-th registered id. Lets the
    // parity audit read the WHOLE registry back instead of only the ids the cache knows.
    name: "sourceIds",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "SourceRegistered",
    type: "event",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "contentCid", type: "string", indexed: false },
    ],
  },
  {
    name: "SourceUpdated",
    type: "event",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "updater", type: "address", indexed: true },
    ],
  },
  {
    name: "SourceDeactivated",
    type: "event",
    inputs: [{ name: "id", type: "bytes32", indexed: true }],
  },
] as const;

/** V2/V3 share revision-checked edits. Unchecked V1 selectors are absent. */
export const REVISIONED_REGISTRY_ABI = [
  ...REGISTRY_ABI.filter((entry): entry is Exclude<(typeof REGISTRY_ABI)[number], { name: "update" | "deactivate" }> =>
    entry.name !== "update" && entry.name !== "deactivate"),
  {
    name: "registryVersion", type: "function", stateMutability: "pure", inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "getWithRevision", type: "function", stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "record", type: "tuple", components: REGISTRY_ABI[3].outputs[0].components },
      { name: "revision", type: "uint64" },
    ],
  },
  {
    name: "update", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "bytes32" }, { name: "expectedRevision", type: "uint64" },
      REGISTRY_ABI[1].inputs[1], REGISTRY_ABI[1].inputs[2], REGISTRY_ABI[1].inputs[3],
      REGISTRY_ABI[1].inputs[4], REGISTRY_ABI[1].inputs[5],
    ],
    outputs: [],
  },
  {
    name: "updatePrice", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "bytes32" }, { name: "expectedRevision", type: "uint64" }, { name: "fetchPriceUsdc6", type: "uint64" }],
    outputs: [],
  },
  {
    name: "deactivate", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "bytes32" }, { name: "expectedRevision", type: "uint64" }],
    outputs: [],
  },
] as const;
