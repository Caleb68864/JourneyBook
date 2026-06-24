import { Hero } from "./components/Hero";

/**
 * App shell. Renders the branded landing hero (Stage 4). The original Stage 0
 * health probe (GET /health + /health/db) is preserved inside the hero footer
 * as the "Field link" status chip — see components/HealthChip.tsx.
 */
export default function App() {
  return <Hero />;
}
