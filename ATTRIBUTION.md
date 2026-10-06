# Epoch Protocol: Attributions and References

Epoch Protocol builds upon foundational academic research in market design, decentralized finance primitives, and open-source tooling on Solana.

---

## 1. Academic & Economic Literature

- **Frequent Batch Auctions (FBA):**
  - **Reference:** Budish, E., Cramton, P., & Shim, J. (2015). *"The High-Frequency Trading Arms Race: Frequent Batch Auctions as a Market Design Response"*. *The Quarterly Journal of Economics*, 130(4), 1547–1621.
  - **Contribution:** Conceptual framework for replacing continuous double auctions with discrete-time uniform-price batch auctions to eliminate latency arbitrage and reduce adverse selection.
- **Uniform Price Clearing & Maximum Social Surplus:**
  - Standard microeconomic auction theory for discrete clearing tick search and pro-rata volume rationing at the marginal crossing tick.

---

## 2. Core Open-Source Infrastructure & Frameworks

- **Anchor Framework:**
  - Developed by Coral Systems / Armani Ferrante.
  - License: Apache 2.0.
  - Used for zero-copy account deserialization, program IDL generation, and instruction dispatching.
- **Solana Web3.js:**
  - Developed by Solana Labs / Anza.
  - License: Apache 2.0 / MIT.
  - Used for RPC client communication, transaction construction, and cryptographic signature management.
- **Pyth Network:**
  - Developed by Douro Labs / Pyth Data Association.
  - License: Apache 2.0.
  - Low-latency financial oracle interface for reference index pricing and confidence interval validation.
- **Bun Runtime:**
  - Developed by Jarred Sumner / Oven.
  - License: MIT.
  - Fast JavaScript runtime used for benchmark execution, TypeScript testing, and development server workflows.
- **Next.js & Tailwind CSS:**
  - Developed by Vercel and Tailwind Labs.
  - License: MIT.
  - High-performance React framework for the headless trading interface and responsive terminal components.
- **Playwright:**
  - Developed by Microsoft.
  - License: Apache 2.0.
  - Headless browser automation framework utilized for deterministic visual and behavioral acceptance testing across viewports.
