export const MANY_OPEN_AGENTS = 12

/**
 * Stays up while 12+ agent chats are open. Hive never closes one by itself
 * (owner, 11-04); this only says that many open chats use a lot of memory.
 */
export function ManyAgentsBanner({ open }: { open: number }) {
  if (open < MANY_OPEN_AGENTS) return null
  return (
    <div role="status" aria-label={`${open} agents open`}
      className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-bg-secondary shadow-e3 border border-status-waiting/60 text-[13px]">
      <span className="w-[7px] h-[7px] rounded-full bg-status-waiting" />
      <span className="font-semibold text-text-primary">{open} agents open</span>
      <span className="text-text-muted">Close the ones you are done with to free memory</span>
    </div>
  )
}
