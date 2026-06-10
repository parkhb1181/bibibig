// Phase 5: dynamic OG image — typography-only, edge runtime
export const runtime = 'edge'

export function GET() {
  return new Response('og stub', { status: 200 })
}
