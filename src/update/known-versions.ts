/**
 * sha256 of every version of each whole-file template in this repo's history, keyed by the path the CLI writes.
 * Hashes are of the content with trailing whitespace removed, so an editor adding or trimming final newlines
 * doesn't turn a template into user content. A file matching one of these holds nothing a user wrote, so update
 * may replace it with the current template; anything else is user content. When a template changes, keep the old
 * hash and add the new one (a unit test checks that every current template is listed).
 */
export const KNOWN_TEMPLATE_HASHES: Record<string, ReadonlyArray<string>> = {
  ".github/actions/setup/action.yml": [
    "2b94bc56e2c59164399cc868ebbbf630e9fbdc71e218d314c9ad79ae36cf99a6", // HEAD, e4bafe7
    "9015db9361f394881589251a7124a177199aec591651c5bf912b55246c3c5acc", // cac3f28
  ],
  ".github/workflows/bumpy-check.yml": [
    "158762b9e7695105f05bb550c8545013695fccefacbbe1c4916047cb9cca18f0", // HEAD, e4bafe7
  ],
  ".github/workflows/bumpy-comment.yml": [
    "8a997f696bf669f230c5f1df1645f5981d75128965ad72606e994f8d8f342989", // HEAD, e4bafe7
  ],
  ".github/workflows/ci.yml": [
    "1f389466d6cd69499c1b10daa8c1affd0bcf55f537267092dac307b56a04d25c", // HEAD, 3eda081
  ],
  ".github/workflows/ci_test.yml": [
    "af7c0d8275ccc062a89b8fe3b8da718b31bc1fb88a0196c926accb18790a5dab", // HEAD, cac3f28
    "f0b55c9eb906eb519a073dae22fa4f5ed9f7c2a895d79456d48849dea1b1092e", // 8c7e2a6
  ],
  ".github/workflows/claude-pr-review.yml": [
    "e99767b76554b8fd45c82825a89858596e19bec130d02c539243847d5b25b485", // 7bb2755, HEAD
    "3a660a41bcbd9b40393cd665faf15827f9bb718300b97458dbd306089e913aa8", // 79b2db0, cac3f28
    "19ffb97cde4b8d160e17bd084a8b6f524e4eee205b2a0bd6a3b6f818706fe336", // 168604f
    "0e282fe6288dc3186c04f6c8f2f936d71cf1eda968c6e2acb4273d7109bb6ef3", // 4a73a8e
    "933359eb2157e8b82a3d29dcaf6458787547ac39681e1d3391d8869bd660cad6", // 7bb2755, HEAD
    "86776b7a941c5995dddcb11de1c1d04cf5eb95c04e133be87b08c40c6ac674d3", // 168604f
    "2c86bc915eb9dfc827f3ceccf184c2d91bd3013946d479be642f6335742c9772", // cac3f28
  ],
  ".github/workflows/knip.yml": [
    "9a153a4afe32f7d5eee2e1938e7e1b46feb436aa26c678e7ba3381891ded8de8", // HEAD, cac3f28
    "de5309bd1566f8f9e3c94123544a1862fc1ef7dfd785f3592952fef44db7d885", // 4a73a8e
    "777b796fd67d51d344a0d76f8a91ef15d73a201fd8615f6788366c70c0a6cdca", // 4fe02b0
    "1345cb63f2db2cc868a4592ae9ed4ba25a69a936fbf926a3a7a6452ac12b2eac", // 8c7e2a6
  ],
  ".github/workflows/lint.yml": [
    "76059ade6515ca34507baabe726d14edfc357c2ac9abd5cdba8e792e760ac908", // HEAD, cac3f28
    "53870e80e7d8989e9c8a127cc918142beac92c297053977f4bc33b6c36fd68e5", // 4a73a8e
    "0903d40743ba92351df2645f8e04f35270868aaca70131226c0a3b109fdc7f7b", // 4fe02b0
    "0085a960859497b5c17e98a9c5ae4860765050c4ae67d50590f276f3ac776cae", // 8c7e2a6
  ],
  ".github/workflows/release.yml": [
    "4dfaa99e4c5bf5dd854ef3ec28cca8693f82e01105b8570875f5a60c097dcc6f", // HEAD, e4bafe7
    "9cce0fac55beaa84cc0ef00384dd36b44b894a5fc3ad45084f7940b61c9b2cf3", // HEAD, e4bafe7
  ],
  ".github/workflows/ts-check.yml": [
    "5b68d7ab00b8ae82a0c59b08ae13b052c78d3d8fa3c1e18c4697f98f1e11310b", // HEAD, cac3f28
    "c8da57fdf4654ed51369bd7dc085a561896e24542edf0825daa1242cc335d833", // 4a73a8e
    "a90047daa49a38a55732b0f5905cea7f0b1ca70026c839c8bc253d2e01315be7", // 4fe02b0
    "4628573291a354c016d7f457b111acf6dd3c6d674c0a31e49b0191c1eb0f7f32", // 8c7e2a6
  ],
  ".husky/commit-msg": [
    "032ed08e6a43c0fad17ccd5edc2ff91cbd935e57f7652b57f812d879db117967", // 34e03bd
    "05743465ac860c90666878f41b1a0969bba1879a3a83abf49d777ee7b060c515", // 2d52b23
    "431cc5bc990e2937c7be7213744124769781935a0cb7e220dd24abb96937d12e", // 2abe477, 4a73a8e
    "7f830f22f7e663767ddddc83d96eb2731db808b9d28d2266d324676c9e0d74a2", // 7b6a133, 8c7e2a6, c4b8fa9, c691b0e
    "16d109044f16b6fe243ae5ca70ab646349063714c4864f39ff1b20995d3678dc", // c18562c
  ],
  ".husky/pre-push": [
    "c340d86a13df13862a91dde43194606c9910129fd7399e3edd2554198eb6aed7", // 2abe477, 2d52b23, 34e03bd, 4a73a8e
  ],
  "commitlint.config.js": [
    "08d99eaab57c71b6c1d6724a6150737e2bdef0ccbdc9af9ec194b6cbf37d079c", // 4a73a8e, 7b6a133, 8c7e2a6, c18562c
  ],
  "eslint.config.style.ts": [
    "aab9fafa819d1d5fc8e66e990f670baf343f398e30a2abc5a84a7e6a16d6872b", // 50e613c, 5d2a510, eca4fe2
    "0d9eeac7c66460d7f618708dc30cee4f6f4d432740e0552c3a28046aed8dacb6", // 2abe477, 4a73a8e
    "e0f782437a1f74902b99ce2d727217a2781ccca748bb668917f7a88a12181151", // 7b6a133, 8c7e2a6, c18562c, c4b8fa9
  ],
  "eslint.config.ts": [
    "234e4556e5f5fa1d5355bf95243b0bd76d2187aaeea48e451f3bdc9289fc4ba9", // 2abe477, 50e613c, 5d2a510, eca4fe2
    "8e69510cf12b8f6e8cae2a441c0879a453a67c6ca39e3ff1aeb83e062e0ca609", // 4a73a8e
    "1c3f9e9498b11ef9db1cf4ff57f4bb94787590b88f0159a4a7a387acb2c84263", // 7b6a133, 8c7e2a6, c18562c, c4b8fa9
  ],
};
