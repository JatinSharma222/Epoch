export default function Home() {
  return (
    <main>
      <h1>Epoch</h1>
      <p>Frequent Batch Auction (FBA) perpetual-futures exchange on Solana (devnet).</p>
      <div>
        <h2>System Status</h2>
        <ul>
          <li>Program: Scaffolded (Anchor, zero-copy ~10KB Batch account)</li>
          <li>Auction Batch Interval: 2 slots (~800ms)</li>
          <li>Oracle Grid: Oracle-relative offsets in basis points</li>
          <li>Clearing: Deterministic uniform clearing price on-chain</li>
        </ul>
      </div>
    </main>
  );
}
