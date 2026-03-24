import { useEffect, useRef } from 'react'
import type { Agent } from '../types'

interface Props {
  agents: Agent[]
  onAgentClick?: (agentId: string) => void
}

const TILE = 16
const SCALE = 2
const S = TILE * SCALE
const COLS = 22
const ROWS = 14

const C = {
  floor: '#1a1128', floorLine: '#201530', wall: '#2d1f48', wallTop: '#3b2a5e',
  desk: '#2d1f48', deskTop: '#3b2a5e', monitor: '#0a0a0a', monitorScreen: '#1e1b4b',
  keyboard: '#374151', chair: '#2d1f48', chairBack: '#3b2a5e',
  plant: '#22c55e', plantDark: '#16a34a', pot: '#5c3317',
  coffee: '#4b5563', coffeeTop: '#6b7280', rug: '#231838',
  whiteboard: '#e2e8f0', whiteboardFrame: '#64748b',
}

const DESK_POSITIONS = [
  { x: 3, y: 3 }, { x: 8, y: 3 }, { x: 13, y: 3 },
  { x: 3, y: 8 }, { x: 8, y: 8 }, { x: 13, y: 8 },
]

function darken(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount)
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount)
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

export default function OfficeView({ agents, onAgentClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wanderState = useRef<Map<string, { x: number; y: number; tx: number | null; ty: number | null; timer: number }>>(new Map())
  const renderAgents = useRef<{ id: string; rx: number; ry: number }[]>([])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = COLS * S
    canvas.height = ROWS * S

    let tick = 0
    let rafId: number

    // Assign desks
    const agentDesks = new Map<string, { x: number; y: number }>()
    agents.forEach((a, i) => {
      if (i < DESK_POSITIONS.length) agentDesks.set(a.id, DESK_POSITIONS[i])
    })

    const px = (x: number, y: number, w: number, h: number, color: string) => {
      ctx.fillStyle = color
      ctx.fillRect(x, y, w, h)
    }

    const pxT = (x: number, y: number, w: number, h: number, color: string) => {
      px(x * S, y * S, w * S, h * S, color)
    }

    function drawFloor() {
      px(0, 0, COLS * S, ROWS * S, C.floor)
      ctx.strokeStyle = C.floorLine
      ctx.lineWidth = 0.5
      for (let i = 0; i <= COLS; i++) { ctx.beginPath(); ctx.moveTo(i * S, 0); ctx.lineTo(i * S, ROWS * S); ctx.stroke() }
      for (let i = 0; i <= ROWS; i++) { ctx.beginPath(); ctx.moveTo(0, i * S); ctx.lineTo(COLS * S, i * S); ctx.stroke() }
      pxT(2, 2, 16, 11, C.rug)
    }

    function drawWalls() {
      px(0, 0, COLS * S, S * 1.5, C.wall)
      px(0, 0, COLS * S, S * 0.3, C.wallTop)
      px(0, 0, S * 0.3, ROWS * S, C.wall)
      px((COLS - 0.3) * S, 0, S * 0.3, ROWS * S, C.wall)
      px(0, (ROWS - 0.3) * S, COLS * S, S * 0.3, C.wall)
      pxT(10, ROWS - 0.3, 2, 0.3, '#231838')
    }

    function drawDesk(x: number, y: number) {
      const dx = x * S, dy = y * S
      // Desk surface
      px(dx, dy, 3.5 * S, 1.8 * S, C.desk)
      px(dx + 2, dy + 2, 3.5 * S - 4, 1.8 * S - 4, C.deskTop)
      // Dual monitors
      px(dx + 0.2 * S, dy + 0.1 * S, 1.3 * S, 0.9 * S, C.monitor)
      px(dx + 0.3 * S, dy + 0.2 * S, 1.1 * S, 0.7 * S, C.monitorScreen)
      px(dx + 1.7 * S, dy + 0.1 * S, 1.3 * S, 0.9 * S, C.monitor)
      px(dx + 1.8 * S, dy + 0.2 * S, 1.1 * S, 0.7 * S, C.monitorScreen)
      // Monitor stands
      px(dx + 0.7 * S, dy + 1.0 * S, 0.3 * S, 0.15 * S, '#4b5563')
      px(dx + 2.2 * S, dy + 1.0 * S, 0.3 * S, 0.15 * S, '#4b5563')
      // Keyboard
      px(dx + 0.6 * S, dy + 1.3 * S, 1.5 * S, 0.3 * S, C.keyboard)
      // Mouse
      px(dx + 2.3 * S, dy + 1.35 * S, 0.4 * S, 0.25 * S, '#4b5563')
      // Coffee cup on desk
      px(dx + 3.0 * S, dy + 0.4 * S, 0.3 * S, 0.35 * S, '#f8fafc')
      px(dx + 3.0 * S, dy + 0.35 * S, 0.3 * S, 0.1 * S, '#94a3b8')
    }

    function drawGamingChair(x: number, y: number) {
      const cx = (x + 1.2) * S, cy = (y + 2.2) * S
      // Wheels base
      px(cx - 0.1 * S, cy + 1.0 * S, 1.2 * S, 0.15 * S, '#1e1b4b')
      px(cx + 0.1 * S, cy + 1.15 * S, 0.2 * S, 0.1 * S, '#374151')
      px(cx + 0.7 * S, cy + 1.15 * S, 0.2 * S, 0.1 * S, '#374151')
      // Seat
      px(cx - 0.2 * S, cy + 0.3 * S, 1.4 * S, 0.7 * S, '#1e1b4b')
      px(cx, cy + 0.4 * S, 1.0 * S, 0.5 * S, '#7c3aed')
      // Back rest (tall)
      px(cx - 0.3 * S, cy - 0.8 * S, 1.6 * S, 1.1 * S, '#1e1b4b')
      px(cx - 0.1 * S, cy - 0.6 * S, 1.2 * S, 0.8 * S, '#7c3aed')
      // Head rest
      px(cx + 0.1 * S, cy - 1.0 * S, 0.8 * S, 0.3 * S, '#1e1b4b')
      // Purple racing stripes
      px(cx + 0.35 * S, cy - 0.5 * S, 0.3 * S, 0.6 * S, '#a78bfa')
      // Arm rests
      px(cx - 0.4 * S, cy + 0.1 * S, 0.2 * S, 0.5 * S, '#374151')
      px(cx + 1.2 * S, cy + 0.1 * S, 0.2 * S, 0.5 * S, '#374151')
    }

    function drawCoffeeMachine(x: number, y: number) {
      // Counter
      pxT(x, y, 2, 1.5, '#4b5563')
      pxT(x + 0.1, y + 0.1, 1.8, 1.3, '#6b7280')
      // Machine body
      pxT(x + 0.3, y - 1.2, 1.4, 1.2, '#374151')
      pxT(x + 0.4, y - 1.0, 1.2, 0.8, '#1e293b')
      // Red light
      pxT(x + 0.5, y - 0.3, 0.2, 0.2, '#ef4444')
      // Green light
      pxT(x + 0.8, y - 0.3, 0.2, 0.2, '#22c55e')
      // Drip area
      pxT(x + 0.6, y + 0.2, 0.8, 0.3, '#1e293b')
      // Cup
      pxT(x + 0.8, y + 0.3, 0.4, 0.5, '#f8fafc')
      // Steam (animated via tick)
      ctx.fillStyle = 'rgba(200,200,200,0.3)'
      const steamY = y - 1.3 - Math.sin(tick * 0.08) * 0.2
      pxT(x + 0.7, steamY, 0.15, 0.3, 'rgba(200,200,200,0.2)')
      pxT(x + 1.0, steamY - 0.1, 0.15, 0.3, 'rgba(200,200,200,0.15)')
      // Label
      ctx.font = '7px sans-serif'
      ctx.fillStyle = '#94a3b8'
      ctx.textAlign = 'center'
      ctx.fillText('COFFEE', (x + 1) * S, (y + 1.8) * S)
    }

    function drawGymArea(x: number, y: number) {
      // Gym mat
      pxT(x, y, 3, 2, '#1e3a2f')
      pxT(x + 0.1, y + 0.1, 2.8, 1.8, '#22543d')
      // Treadmill
      pxT(x + 0.3, y + 0.3, 1.0, 1.4, '#374151')
      pxT(x + 0.4, y + 0.4, 0.8, 0.6, '#1e293b')
      // Treadmill screen
      pxT(x + 0.5, y + 0.45, 0.6, 0.35, '#0a0a0a')
      pxT(x + 0.55, y + 0.5, 0.5, 0.25, '#22c55e')
      // Dumbbell rack
      pxT(x + 1.6, y + 0.3, 1.2, 0.6, '#4b5563')
      // Dumbbells
      pxT(x + 1.7, y + 0.4, 0.3, 0.15, '#94a3b8')
      pxT(x + 2.1, y + 0.4, 0.3, 0.15, '#94a3b8')
      pxT(x + 1.7, y + 0.65, 0.3, 0.15, '#78716c')
      pxT(x + 2.1, y + 0.65, 0.3, 0.15, '#78716c')
      // Yoga ball
      ctx.beginPath()
      ctx.arc((x + 2.2) * S, (y + 1.5) * S, S * 0.35, 0, Math.PI * 2)
      ctx.fillStyle = '#a78bfa'
      ctx.fill()
      // Label
      ctx.font = '7px sans-serif'
      ctx.fillStyle = '#4ade80'
      ctx.textAlign = 'center'
      ctx.fillText('GYM', (x + 1.5) * S, (y + 2.3) * S)
    }

    function drawAgent(agent: Agent, desk: { x: number; y: number }) {
      const atDesk = agent.status === 'working'
      const skin = agent.avatar?.skinTone || '#f5d0a9'
      const hair = agent.avatar?.hairColor || '#2c1810'
      const top = agent.avatar?.topColor || '#7c3aed'
      const bottom = agent.avatar?.bottomColor || '#1e293b'

      let ax: number, ay: number
      if (atDesk) {
        ax = (desk.x + 1) * S
        ay = (desk.y + 2.2) * S
      } else {
        const ws = wanderState.current.get(agent.id)
        if (ws) { ax = ws.x; ay = ws.y }
        else { ax = (desk.x + 1) * S; ay = (desk.y + 3.5) * S }
      }

      renderAgents.current.push({ id: agent.id, rx: ax, ry: ay })
      const s = S * 0.06

      px(ax - 6*s, ay - 8*s, 12*s, 12*s, top)
      const armBob = atDesk ? Math.sin(tick * 0.15) * 1.5 : 0
      px(ax - 9*s, ay - 5*s + armBob, 3*s, 8*s, skin)
      px(ax + 6*s, ay - 5*s - armBob, 3*s, 8*s, skin)

      if (!atDesk) {
        px(ax - 4*s, ay + 4*s, 3*s, 6*s, bottom)
        px(ax + 1*s, ay + 4*s, 3*s, 6*s, bottom)
        px(ax - 5*s, ay + 10*s, 4*s, 2*s, '#1e1b4b')
        px(ax + 1*s, ay + 10*s, 4*s, 2*s, '#1e1b4b')
      } else {
        px(ax - 4*s, ay + 4*s, 8*s, 4*s, bottom)
      }

      px(ax - 7*s, ay - 20*s, 14*s, 12*s, skin)
      px(ax - 8*s, ay - 23*s, 16*s, 6*s, hair)
      px(ax - 8*s, ay - 20*s, 2*s, 4*s, hair)
      px(ax + 6*s, ay - 20*s, 2*s, 4*s, hair)

      const blink = Math.sin(tick * 0.02) > 0.98
      if (!blink) {
        px(ax - 4*s, ay - 15*s, 2.5*s, 2.5*s, '#1e1b4b')
        px(ax + 2*s, ay - 15*s, 2.5*s, 2.5*s, '#1e1b4b')
      }
      px(ax - 1*s, ay - 11*s, 3*s, 1*s, darken(skin, 40))

      const statusColors: Record<string, string> = { working: '#4ade80', waiting: '#fbbf24', done: '#64748b' }
      ctx.beginPath()
      ctx.arc(ax, ay - 28*s, 3, 0, Math.PI * 2)
      ctx.fillStyle = statusColors[agent.status] || '#64748b'
      ctx.fill()

      ctx.font = '10px "DM Sans", system-ui, sans-serif'
      ctx.fillStyle = '#c4b5fd'
      ctx.textAlign = 'center'
      ctx.fillText(agent.name, ax, ay - 32*s)

      if (atDesk) {
        const dots = '.'.repeat((Math.floor(tick / 15) % 3) + 1)
        ctx.font = 'bold 9px monospace'
        ctx.fillStyle = '#4ade80'
        ctx.fillText(dots, ax + 1.5 * S, ay - 2*s)
      }

      if (agent.status === 'waiting') {
        if (Math.sin(tick * 0.06) > 0.3) {
          ctx.font = 'bold 12px sans-serif'
          ctx.fillStyle = '#fbbf24'
          ctx.fillText('?', ax + 10*s, ay - 20*s)
        }
      }
    }

    function updateWanderers() {
      agents.forEach((a, i) => {
        if (a.status === 'working') { wanderState.current.delete(a.id); return }
        const desk = agentDesks.get(a.id)
        if (!desk) return

        let ws = wanderState.current.get(a.id)
        if (!ws) {
          ws = { x: (desk.x + 1.5) * S, y: (desk.y + 3) * S, tx: null, ty: null, timer: Math.random() * 120 }
          wanderState.current.set(a.id, ws)
        }

        ws.timer--
        if (ws.timer <= 0 && ws.tx === null) {
          const targets = [
            [(19.5 + Math.random()) * S, (3 + Math.random()) * S],       // coffee machine
            [(desk.x + 1 + Math.random() * 2) * S, (desk.y + 3 + Math.random() * 2) * S], // near desk
            [(18.5 + Math.random()) * S, (9.5 + Math.random()) * S],     // sofa/lounge
            [(7 + Math.random() * 4) * S, (2 + Math.random()) * S],      // whiteboard
            [(19 + Math.random() * 2) * S, (6 + Math.random()) * S],     // gym area
          ]
          const t = targets[Math.floor(Math.random() * targets.length)]
          ws.tx = t[0]; ws.ty = t[1]
        }

        if (ws.tx !== null && ws.ty !== null) {
          const dx = ws.tx - ws.x, dy = ws.ty - ws.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 3) {
            ws.tx = null; ws.ty = null
            ws.timer = 60 + Math.random() * 180
          } else {
            ws.x += (dx / dist) * 1.2
            ws.y += (dy / dist) * 1.2
          }
        }
      })
    }

    function render() {
      tick++
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      renderAgents.current = []

      drawFloor()
      drawWalls()

      // Furniture
      // Whiteboard
      pxT(7, 1.5, 3, 2, C.whiteboardFrame); pxT(7.1, 1.6, 2.8, 1.8, C.whiteboard)
      ctx.font = '6px monospace'; ctx.fillStyle = '#7c3aed'; ctx.textAlign = 'left'
      ctx.fillText('Sprint Board', 7.3 * S, 1.9 * S)
      for (let i = 0; i < 3; i++) px(7.3 * S, (2.1 + i * 0.3) * S, (1 + Math.random() * 1.5) * S, 2, '#a78bfa44')

      // Coffee machine
      drawCoffeeMachine(19, 2.5)

      // Sofa
      pxT(18, 9, 3, 1.2, '#4c1d95'); pxT(18.15, 9.15, 2.7, 0.9, '#6d28d9')
      pxT(18.3, 9.3, 1.1, 0.6, '#7c3aed'); pxT(19.6, 9.3, 1.1, 0.6, '#7c3aed')
      ctx.font = '6px sans-serif'; ctx.fillStyle = '#64748b'; ctx.textAlign = 'center'
      ctx.fillText('LOUNGE', 19.5 * S, 10.5 * S)

      // Gym area
      drawGymArea(18, 5.5)

      // Plants
      const drawPlant = (x: number, y: number) => {
        pxT(x, y, 0.6, 0.5, C.pot)
        pxT(x - 0.15, y - 0.6, 0.9, 0.6, C.plant)
        pxT(x + 0.05, y - 0.9, 0.5, 0.4, C.plantDark)
      }
      drawPlant(1, 12); drawPlant(20.5, 12); drawPlant(17, 4.5)
      drawPlant(1, 1.8); drawPlant(0.8, 7)

      // Desks + Gaming chairs
      agents.forEach((a) => {
        const desk = agentDesks.get(a.id)
        if (desk) { drawDesk(desk.x, desk.y); if (a.status === 'working') drawGamingChair(desk.x, desk.y) }
      })

      updateWanderers()

      // Draw agents sorted by Y
      const sorted = agents.filter(a => agentDesks.has(a.id)).sort((a, b) => {
        const ad = agentDesks.get(a.id)!, bd = agentDesks.get(b.id)!
        const ay2 = a.status === 'working' ? ad.y : (wanderState.current.get(a.id)?.y || ad.y * S) / S
        const by2 = b.status === 'working' ? bd.y : (wanderState.current.get(b.id)?.y || bd.y * S) / S
        return ay2 - by2
      })
      sorted.forEach(a => { const desk = agentDesks.get(a.id); if (desk) drawAgent(a, desk) })

      // Title + Legend centered
      ctx.font = 'bold 11px "DM Sans", system-ui, sans-serif'
      ctx.fillStyle = '#7c3aed'
      ctx.textAlign = 'center'
      ctx.fillText('HIVE OFFICE', (COLS / 2) * S, 0.7 * S)

      ctx.font = '8px sans-serif'
      const legend: [string, string][] = [['● Working', '#4ade80'], ['● Waiting', '#fbbf24'], ['● Idle', '#64748b']]
      legend.forEach(([text, color], i) => {
        ctx.fillStyle = color
        ctx.textAlign = 'center'
        ctx.fillText(text, (COLS / 2 - 3 + i * 3) * S, 1.2 * S)
      })

      rafId = requestAnimationFrame(render)
    }

    render()

    return () => cancelAnimationFrame(rafId)
  }, [agents])

  // Click handler
  const handleClick = (e: React.MouseEvent) => {
    if (!onAgentClick) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    for (const { id, rx, ry } of renderAgents.current) {
      if (Math.abs(mx - rx) < S && Math.abs(my - (ry - S * 0.3)) < S * 1.2) {
        onAgentClick(id)
        break
      }
    }
  }

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      className="w-full rounded-xl cursor-pointer"
      style={{ imageRendering: 'pixelated', objectFit: 'contain' }}
    />
  )
}
