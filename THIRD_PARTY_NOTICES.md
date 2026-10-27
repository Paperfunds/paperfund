# Third-party material

Apache-2.0 applies only to original Paperfund code owned or licensable by its contributors. npm dependencies retain their own licenses. The lockfile pins versions; installed packages carry upstream licenses and notices. Distributors must preserve applicable notices, including for dependencies bundled into browser output. See `docs/publication/dependency-licenses.json` for the metadata inventory; it does not replace license texts.

## GMGN excerpts: excluded, history remediation pending

The historical RC1 archive included `evidence/module-783515.js` and `evidence/module-812024.js`, acquired GMGN host modules used by an archived native-chart test. No accompanying redistribution license or permission was found. GMGN's [Terms of Service](https://gmgn.ai/static/tos.html), sections 2.1 and 7.1â€“7.3, reserve proprietary rights and distinguish separately licensed open-source components. They do not establish permission to redistribute these excerpts as open-source code.

The obsolete RC1 archive is excluded from the proposed current tree. Current extension 0.2.2 source does not import these excerpts. Apache-2.0 is not asserted over them. Existing history still contains copies; publication requires approved history remediation or sufficient rights-holder permission. No history rewrite has been executed.

## Protocol IDL: permission review pending

The removed `scripts/operator/fixtures/pump-v3-official-idl.json` originated from [pump-fun/pump-public-docs](https://github.com/pump-fun/pump-public-docs). It is not relicensed as Paperfund code. No upstream license was returned by GitHub’s license endpoint at review time (HTTP 404). The fixture is excluded from this tree. The decoder accepts an operator-provided `PAPERFUND_PUMP_V3_IDL_FILE`, retains the exact integrity pin and fails closed when absent. Operators must establish appropriate rights before supplying it. The public repository does not redistribute this file.

Public-chain account fixtures are distinguished from private PAPER account/ledger records. Private records must be removed or anonymized without weakening verification algorithms.## Dependencies with additional distribution obligationsThe pinned Raydium SDK declares GPL-3.0 and `rpc-websockets` declares LGPL-3.0-only. Apache-2.0 on original Paperfund files does not relicense either dependency. This repository does not vendor their code. Distributing combined executable/dependency code requires satisfying applicable upstream source, notice and modification requirements. No Apache-only license claim is made over a dependency bundle.The metadata inventory flags packages whose metadata is absent or refers to a missing license file, including `@orca-so/common-sdk`. Those packages are not redistributed here. Metadata alone does not clear a future bundled release. Review browser dependency output and its attribution separately before distributing new binaries.
