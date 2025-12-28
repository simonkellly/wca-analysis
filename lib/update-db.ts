import { $ } from 'bun';

console.log("Downloading WCA export...");

await $`curl -L https://www.worldcubeassociation.org/export/results/v2/tsv -o db.zip`;
await $`rm -rf wca_export`;
await $`unzip db.zip -d wca_export`;
await $`rm db.zip`;

console.log("Downloaded WCA export");
