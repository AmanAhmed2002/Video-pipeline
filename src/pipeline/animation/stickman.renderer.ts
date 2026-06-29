import type { CanvasRenderingContext2D } from 'canvas';
import { Mood, TimedScene } from '../script/script.types';
import { demoPanelRect } from '../util/demo.util';

/**
 * Everything needed to draw a single frame. The animation service computes
 * these per frame; the renderer is otherwise stateless and side-effect free,
 * which is what makes it swappable for Remotion later.
 */
export interface FrameContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  title: string;
  scene: TimedScene;
  sceneIndex: number;
  totalScenes: number;
  /** Progress through the current scene, 0..1. */
  sceneProgress: number;
  /** Global frame counter (for continuous cycles: blink, walk, talk). */
  globalFrame: number;
  fps: number;
}

interface Palette {
  bgTop: string;
  bgBottom: string;
  ground: string;
  accent: string;
  ink: string;
}

const PALETTES: Record<Mood, Palette> = {
  happy: { bgTop: '#FFE29A', bgBottom: '#FFA585', ground: '#E08D6F', accent: '#FF6B6B', ink: '#2B2B2B' },
  excited: { bgTop: '#C471F5', bgBottom: '#FA71CD', ground: '#A85FC9', accent: '#FFD93D', ink: '#2B2B2B' },
  concerned: { bgTop: '#8FB8DE', bgBottom: '#6B7B9E', ground: '#566080', accent: '#FF8C42', ink: '#1F2937' },
  neutral: { bgTop: '#A8E6CF', bgBottom: '#7BC9A8', ground: '#5FA888', accent: '#3D84A8', ink: '#2B2B2B' },
};

/**
 * Stateless stickman + scene renderer. The single public method draws one full
 * frame onto the provided canvas context.
 */
export class StickmanRenderer {
  render(f: FrameContext): void {
    const palette = PALETTES[f.scene.mood];
    this.drawBackground(f, palette);
    this.drawGround(f, palette);
    // Demo scenes show a framed panel (where the screen recording is overlaid)
    // instead of free-floating props, so the two never collide.
    if (f.scene.show_demo) this.drawDemoPanel(f, palette);
    else this.drawProps(f, palette);
    this.drawStickman(f, palette);
    this.drawTitleCard(f, palette);
    this.drawProgressBar(f, palette);
  }

  /**
   * Draws the bezel/frame for the screen-recording panel. The inner rectangle
   * (demoPanelRect) is left as a dark placeholder — the assembly step overlays
   * the real recording into exactly this rect, so the bezel becomes its frame.
   */
  private drawDemoPanel(f: FrameContext, p: Palette): void {
    const { ctx } = f;
    const r = demoPanelRect(f.width, f.height);
    const bez = 16;

    // Outer rounded bezel (a "device" frame around the recording).
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 18;
    this.roundRect(ctx, r.x - bez, r.y - bez, r.w + bez * 2, r.h + bez * 2, 30);
    ctx.fillStyle = '#15171e';
    ctx.fill();
    ctx.restore();

    // Inner screen placeholder (covered by the overlaid video at assembly time).
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 3;
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    // "● REC / app demo" hint, only visible if the overlay ever falls short.
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 40px Sans';
    ctx.fillText('▶ app demo', r.x + r.w / 2, r.y + r.h / 2);

    // Recording dot + label tab above the panel.
    const tabY = r.y - bez - 30;
    ctx.fillStyle = '#15171e';
    this.roundRect(ctx, r.x - bez, tabY, 188, 40, 12);
    ctx.fill();
    const blink = (Math.sin(f.globalFrame / 6) + 1) / 2;
    ctx.globalAlpha = 0.4 + blink * 0.6;
    ctx.fillStyle = '#FF4D4D';
    this.dot(ctx, r.x - bez + 26, tabY + 20, 7);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.font = 'bold 22px Sans';
    ctx.fillText('LIVE DEMO', r.x - bez + 44, tabY + 21);
  }

  // --- Background -----------------------------------------------------------

  private drawBackground(f: FrameContext, p: Palette): void {
    const { ctx, width, height } = f;
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, p.bgTop);
    grad.addColorStop(1, p.bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Soft drifting "sun" disc for depth; drifts slowly with the global frame.
    const cx = width * 0.78 + Math.sin(f.globalFrame / 120) * 20;
    const cy = height * 0.2;
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(cx, cy, width * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawGround(f: FrameContext, p: Palette): void {
    const { ctx, width, height } = f;
    const groundY = height * 0.78;
    ctx.fillStyle = p.ground;
    ctx.fillRect(0, groundY, width, height - groundY);
  }

  // --- Title card -----------------------------------------------------------

  private drawTitleCard(f: FrameContext, p: Palette): void {
    const { ctx, width, height, title, scene } = f;
    // Title pill near top.
    const pad = 36;
    const boxW = width - pad * 2;
    const boxY = height * 0.06;
    const boxH = 120;
    this.roundRect(ctx, pad, boxY, boxW, boxH, 28);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();

    ctx.fillStyle = p.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 52px Sans';
    this.fitText(ctx, title, boxW - 48, 52);
    ctx.fillText(title, width / 2, boxY + boxH / 2, boxW - 48);

    // Per-scene caption (the narration) along the lower third.
    const capY = height * 0.84;
    const capH = 150;
    this.roundRect(ctx, pad, capY, boxW, capH, 24);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '36px Sans';
    this.wrapText(ctx, scene.text, width / 2, capY + 44, boxW - 56, 44);
  }

  private drawProgressBar(f: FrameContext, p: Palette): void {
    const { ctx, width, height, sceneIndex, totalScenes } = f;
    const overall = (sceneIndex + f.sceneProgress) / totalScenes;
    const barH = 10;
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(0, height - barH, width, barH);
    ctx.fillStyle = p.accent;
    ctx.fillRect(0, height - barH, width * overall, barH);
  }

  // --- Stickman -------------------------------------------------------------

  private drawStickman(f: FrameContext, p: Palette): void {
    const { ctx, width, height, scene, globalFrame, fps } = f;
    const hint = scene.animation_hints.toLowerCase();

    // Base position: in a demo scene stand planted centre-stage (presenting the
    // panel above); otherwise walk if the hint says so, else idle near centre.
    const isWalking = !f.scene.show_demo && /walk|stroll|move|run|enter/.test(hint);
    const baseX = isWalking
      ? width * (0.25 + 0.5 * f.sceneProgress)
      : width * 0.5;
    const bob = Math.sin(globalFrame / 6) * (isWalking ? 8 : 4);
    const groundY = height * 0.78;
    const hipY = groundY - 230 + bob;
    const scale = 1.0;

    ctx.save();
    ctx.translate(baseX, 0);
    ctx.strokeStyle = p.ink;
    ctx.fillStyle = p.ink;
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const walkPhase = globalFrame / 5;

    // Legs (swing when walking, planted otherwise).
    const legSwing = isWalking ? Math.sin(walkPhase) * 28 : 6;
    this.limb(ctx, 0, hipY, -legSwing, hipY + 150, scale);
    this.limb(ctx, 0, hipY, legSwing, hipY + 150, scale);

    // Torso.
    const shoulderY = hipY - 150;
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(0, shoulderY);
    ctx.stroke();

    // Arms — gesture-driven, falls back to a walking swing.
    this.drawArms(ctx, shoulderY, hint, walkPhase, isWalking, f);

    // Head + face.
    const headR = 55;
    const headY = shoulderY - headR - 6;
    ctx.beginPath();
    ctx.arc(0, headY, headR, 0, Math.PI * 2);
    ctx.fillStyle = '#FFF6E5';
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = p.ink;
    ctx.stroke();

    this.drawFace(ctx, headY, headR, scene.mood, globalFrame, fps);

    ctx.restore();
  }

  private drawArms(
    ctx: CanvasRenderingContext2D,
    shoulderY: number,
    hint: string,
    walkPhase: number,
    isWalking: boolean,
    f: FrameContext,
  ): void {
    const handDrop = 95;
    const wave = /wave|hello|hi |greet/.test(hint);
    const point = /point|show|present|chart|graph|this/.test(hint);
    const cheer = /cheer|celebrate|excited|win|yay|raise/.test(hint);

    if (f.scene.show_demo) {
      // Present the panel above: both arms raised toward it with a slight bob.
      const lift = Math.sin(f.globalFrame / 8) * 8;
      this.limb(ctx, 0, shoulderY, -78, shoulderY - 84 + lift, 1);
      this.limb(ctx, 0, shoulderY, 78, shoulderY - 84 - lift, 1);
      return;
    }
    if (cheer) {
      // Both arms up.
      const flap = Math.sin(f.globalFrame / 4) * 14;
      this.limb(ctx, 0, shoulderY, -70, shoulderY - 90 + flap, 1);
      this.limb(ctx, 0, shoulderY, 70, shoulderY - 90 - flap, 1);
      return;
    }
    if (wave) {
      // Right arm waving overhead, left arm resting.
      const w = Math.sin(f.globalFrame / 4) * 25;
      this.limb(ctx, 0, shoulderY, -60, shoulderY + handDrop, 1);
      this.limb(ctx, 0, shoulderY, 80 + w, shoulderY - 70, 1);
      return;
    }
    if (point) {
      // Right arm extended forward to "present" a prop.
      this.limb(ctx, 0, shoulderY, -55, shoulderY + handDrop, 1);
      this.limb(ctx, 0, shoulderY, 110, shoulderY - 10, 1);
      return;
    }
    // Default: arms swing opposite the legs when walking, else hang.
    const swing = isWalking ? Math.sin(walkPhase + Math.PI) * 22 : 8;
    this.limb(ctx, 0, shoulderY, -55 - swing, shoulderY + handDrop, 1);
    this.limb(ctx, 0, shoulderY, 55 + swing, shoulderY + handDrop, 1);
  }

  private drawFace(
    ctx: CanvasRenderingContext2D,
    headY: number,
    r: number,
    mood: Mood,
    globalFrame: number,
    fps: number,
  ): void {
    ctx.strokeStyle = '#2B2B2B';
    ctx.fillStyle = '#2B2B2B';
    ctx.lineWidth = 5;

    // Blink: eyes shut for ~3 frames roughly every 2.5s.
    const blinkPeriod = Math.round(fps * 2.5);
    const isBlinking = globalFrame % blinkPeriod < 3;

    const eyeDX = 20;
    const eyeY = headY - 8;
    if (isBlinking) {
      this.line(ctx, -eyeDX - 8, eyeY, -eyeDX + 8, eyeY);
      this.line(ctx, eyeDX - 8, eyeY, eyeDX + 8, eyeY);
    } else {
      this.dot(ctx, -eyeDX, eyeY, 6);
      this.dot(ctx, eyeDX, eyeY, 6);
    }

    // Eyebrows convey mood.
    ctx.lineWidth = 5;
    switch (mood) {
      case 'concerned':
        this.line(ctx, -eyeDX - 12, eyeY - 22, -eyeDX + 8, eyeY - 14);
        this.line(ctx, eyeDX - 8, eyeY - 14, eyeDX + 12, eyeY - 22);
        break;
      case 'excited':
        this.line(ctx, -eyeDX - 12, eyeY - 24, -eyeDX + 8, eyeY - 26);
        this.line(ctx, eyeDX - 8, eyeY - 26, eyeDX + 12, eyeY - 24);
        break;
      case 'happy':
        this.line(ctx, -eyeDX - 12, eyeY - 20, -eyeDX + 8, eyeY - 24);
        this.line(ctx, eyeDX - 8, eyeY - 24, eyeDX + 12, eyeY - 20);
        break;
      default: // neutral
        this.line(ctx, -eyeDX - 10, eyeY - 20, -eyeDX + 8, eyeY - 20);
        this.line(ctx, eyeDX - 8, eyeY - 20, eyeDX + 10, eyeY - 20);
    }

    // Mouth: talking oscillation + mood-shaped curve.
    const mouthY = headY + 22;
    const talk = (Math.sin(globalFrame / 2.2) + 1) / 2; // 0..1 jaw opening
    ctx.lineWidth = 5;
    ctx.beginPath();
    if (mood === 'happy' || mood === 'excited') {
      // Smile that opens while talking.
      const open = 6 + talk * 14;
      ctx.moveTo(-22, mouthY);
      ctx.quadraticCurveTo(0, mouthY + open, 22, mouthY);
      ctx.stroke();
    } else if (mood === 'concerned') {
      // Slight frown.
      ctx.moveTo(-18, mouthY + 8);
      ctx.quadraticCurveTo(0, mouthY - 6, 18, mouthY + 8);
      ctx.stroke();
    } else {
      // Neutral talking: an opening oval.
      const open = 4 + talk * 12;
      ctx.ellipse(0, mouthY, 12, open / 2 + 3, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // --- Scene props (keyword-driven from animation_hints) --------------------

  /**
   * Keyword → prop registry. Each scene's `animation_hints` is matched against
   * these in order; every match is drawn. To keep multiple props from stacking
   * on top of each other, matches are laid out across a ring of anchor slots
   * around the stickman rather than at fixed coordinates.
   */
  private readonly props: Array<{
    test: RegExp;
    draw: (f: FrameContext, x: number, y: number, p: Palette) => void;
  }> = [
    { test: /water|drink|glass|hydrat|thirst/, draw: (f, x, y) => this.drawGlass(f, x, y) },
    { test: /pill|medicine|drug|vitamin|capsule|dose/, draw: (f, x, y, p) => this.drawPill(f, x, y, p) },
    { test: /food|eat|fruit|apple|veg|meal|diet|nutri/, draw: (f, x, y, p) => this.drawApple(f, x, y, p) },
    { test: /heart|love|health|care|wellness/, draw: (f, x, y, p) => this.drawHeart(f, x, y, p) },
    { test: /chart|graph|grow|increase|data|stat|trend|metric/, draw: (f, x, y, p) => this.drawChart(f, x, y, p) },
    { test: /money|cash|save|cost|dollar|budget|price|pay/, draw: (f, x, y, p) => this.drawCoin(f, x, y, p) },
    { test: /idea|think|learn|brain|smart|tip|insight/, draw: (f, x, y, p) => this.drawBulb(f, x, y, p) },
    { test: /time|clock|hour|minute|fast|quick|schedule|deadline/, draw: (f, x, y, p) => this.drawClock(f, x, y, p) },
    { test: /phone|mobile|call|text|app|swipe|scroll/, draw: (f, x, y, p) => this.drawPhone(f, x, y, p) },
    { test: /book|read|study|story|learn|knowledge|page/, draw: (f, x, y, p) => this.drawBook(f, x, y, p) },
    { test: /sun|sunny|weather|warm|bright|morning|day|solar/, draw: (f, x, y, p) => this.drawSun(f, x, y, p) },
    { test: /plant|grow|tree|nature|green|seed|garden|eco|leaf/, draw: (f, x, y, p) => this.drawPlant(f, x, y, p) },
    { test: /star|rating|review|favou?rite|best|quality|top/, draw: (f, x, y, p) => this.drawStar(f, x, y, p) },
    { test: /say|talk|speak|chat|ask|question|comment|message/, draw: (f, x, y, p) => this.drawSpeechBubble(f, x, y, p) },
    { test: /up|rise|boost|increase|improve|level|progress|gain/, draw: (f, x, y, p) => this.drawArrowUp(f, x, y, p) },
    { test: /check|done|correct|right|success|complete|tick|verif/, draw: (f, x, y, p) => this.drawCheck(f, x, y, p) },
    { test: /fire|hot|burn|energy|calorie|fuel|spicy|trend/, draw: (f, x, y, p) => this.drawFire(f, x, y, p) },
    { test: /world|global|earth|planet|travel|country|map/, draw: (f, x, y, p) => this.drawGlobe(f, x, y, p) },
    { test: /gear|setting|config|machine|work|process|system|tool/, draw: (f, x, y, p) => this.drawGear(f, x, y, p) },
    { test: /rocket|launch|start|fast|space|grow|scale|boost/, draw: (f, x, y, p) => this.drawRocket(f, x, y, p) },
    { test: /sleep|rest|night|moon|relax|calm|dream|bed/, draw: (f, x, y, p) => this.drawMoon(f, x, y, p) },
    { test: /warn|caution|danger|risk|alert|careful|avoid|problem/, draw: (f, x, y, p) => this.drawWarning(f, x, y, p) },
    { test: /trophy|win|award|champion|goal|achieve|prize|reward/, draw: (f, x, y, p) => this.drawTrophy(f, x, y, p) },
    { test: /music|song|sound|audio|listen|beat|rhythm/, draw: (f, x, y, p) => this.drawMusicNote(f, x, y, p) },
  ];

  /** Anchor slots around the stickman, filled in order as props match. */
  private propSlots(f: FrameContext): Array<{ x: number; y: number }> {
    const x = f.width * 0.5;
    const y = f.height * 0.5;
    return [
      { x: x + 250, y: y - 120 },
      { x: x - 270, y: y - 120 },
      { x: x + 270, y: y + 20 },
      { x: x - 290, y: y + 20 },
      { x: x + 230, y: y + 160 },
      { x: x - 250, y: y + 160 },
    ];
  }

  private drawProps(f: FrameContext, p: Palette): void {
    const hint = f.scene.animation_hints.toLowerCase();
    const slots = this.propSlots(f);
    // Gentle, staggered float so props feel alive without moving in lockstep.
    let slot = 0;
    for (const prop of this.props) {
      if (!prop.test.test(hint)) continue;
      if (slot >= slots.length) break; // cap props per scene to avoid clutter
      const anchor = slots[slot];
      const float = Math.sin(f.globalFrame / 10 + slot) * 10;
      prop.draw(f, anchor.x, anchor.y + float, p);
      slot++;
    }
  }

  private drawGlass(f: FrameContext, x: number, y: number): void {
    const { ctx } = f;
    ctx.save();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#2B2B2B';
    ctx.beginPath();
    ctx.moveTo(x - 28, y - 40);
    ctx.lineTo(x - 22, y + 50);
    ctx.lineTo(x + 22, y + 50);
    ctx.lineTo(x + 28, y - 40);
    ctx.closePath();
    ctx.stroke();
    // Water fill with a wobbling surface.
    const surf = y - 6 + Math.sin(f.globalFrame / 6) * 3;
    ctx.fillStyle = 'rgba(61,132,168,0.8)';
    ctx.beginPath();
    ctx.moveTo(x - 25, surf);
    ctx.lineTo(x - 22, y + 48);
    ctx.lineTo(x + 22, y + 48);
    ctx.lineTo(x + 25, surf);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawPill(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.5);
    this.roundRect(ctx, -45, -18, 90, 36, 18);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    this.roundRect(ctx, -45, -18, 45, 36, 18);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#2B2B2B';
    this.roundRect(ctx, -45, -18, 90, 36, 18);
    ctx.stroke();
    ctx.restore();
  }

  private drawApple(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    ctx.save();
    ctx.fillStyle = '#E84855';
    ctx.beginPath();
    ctx.arc(x - 12, y, 26, 0, Math.PI * 2);
    ctx.arc(x + 12, y, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6B3F1D';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x, y - 24);
    ctx.lineTo(x, y - 40);
    ctx.stroke();
    ctx.fillStyle = '#4CAF50';
    ctx.beginPath();
    ctx.ellipse(x + 14, y - 36, 14, 7, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawHeart(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    // Subtle heartbeat pulse.
    const s = 1 + Math.sin(f.globalFrame / 5) * 0.08;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = '#FF4D6D';
    ctx.beginPath();
    ctx.moveTo(0, 18);
    ctx.bezierCurveTo(-30, -10, -10, -34, 0, -14);
    ctx.bezierCurveTo(10, -34, 30, -10, 0, 18);
    ctx.fill();
    ctx.restore();
  }

  private drawChart(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    ctx.save();
    ctx.translate(x, y);
    // Axes.
    ctx.strokeStyle = '#2B2B2B';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-10, -90);
    ctx.lineTo(-10, 10);
    ctx.lineTo(120, 10);
    ctx.stroke();
    // Bars that grow with scene progress.
    const heights = [30, 55, 80, 100];
    ctx.fillStyle = p.accent;
    heights.forEach((h, i) => {
      const grown = h * Math.min(1, f.sceneProgress * 1.4);
      ctx.fillRect(2 + i * 28, 8 - grown, 20, grown);
    });
    ctx.restore();
  }

  private drawCoin(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    ctx.save();
    ctx.fillStyle = '#FFD93D';
    ctx.strokeStyle = '#C9A227';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x, y, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#C9A227';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 40px Sans';
    ctx.fillText('$', x, y + 2);
    ctx.restore();
  }

  private drawBulb(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    const glow = (Math.sin(f.globalFrame / 6) + 1) / 2;
    ctx.save();
    ctx.globalAlpha = 0.3 + glow * 0.5;
    ctx.fillStyle = '#FFE066';
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#2B2B2B';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#888';
    ctx.fillRect(x - 12, y + 24, 24, 12);
    ctx.restore();
  }

  private drawClock(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#2B2B2B';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Hands sweep with the global frame so the clock visibly ticks.
    const t = f.globalFrame / f.fps;
    ctx.lineCap = 'round';
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 5;
    this.line(ctx, 0, 0, Math.sin(t) * 16, -Math.cos(t) * 16); // minute
    ctx.lineWidth = 6;
    this.line(ctx, 0, 0, Math.sin(t / 12) * 10, -Math.cos(t / 12) * 10); // hour
    ctx.fillStyle = p.accent;
    this.dot(ctx, 0, 0, 4);
    ctx.restore();
  }

  private drawPhone(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#2B2B2B';
    this.roundRect(ctx, -26, -46, 52, 92, 10);
    ctx.fill();
    ctx.fillStyle = p.accent;
    this.roundRect(ctx, -21, -38, 42, 70, 4);
    ctx.fill();
    // A "notification" line that slides in.
    const slide = (Math.sin(f.globalFrame / 12) + 1) / 2;
    ctx.fillStyle = '#FFFFFF';
    ctx.globalAlpha = 0.85;
    this.roundRect(ctx, -17, -32 + slide * 6, 34, 9, 3);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#FFFFFF';
    this.dot(ctx, 0, 39, 3);
    ctx.restore();
  }

  private drawBook(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = '#2B2B2B';
    ctx.lineWidth = 4;
    ctx.fillStyle = p.accent;
    // Two facing pages.
    ctx.beginPath();
    ctx.moveTo(0, -28);
    ctx.lineTo(-40, -20);
    ctx.lineTo(-40, 28);
    ctx.lineTo(0, 22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -28);
    ctx.lineTo(40, -20);
    ctx.lineTo(40, 28);
    ctx.lineTo(0, 22);
    ctx.closePath();
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.stroke();
    // Text lines.
    ctx.strokeStyle = '#9aa3b2';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) this.line(ctx, 8, -14 + i * 10, 32, -12 + i * 10);
    ctx.restore();
  }

  private drawSun(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((f.globalFrame / 60) % (Math.PI * 2));
    ctx.strokeStyle = '#FFB454';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.line(ctx, Math.cos(a) * 30, Math.sin(a) * 30, Math.cos(a) * 44, Math.sin(a) * 44);
    }
    ctx.restore();
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#FFD93D';
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawPlant(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    ctx.save();
    ctx.translate(x, y);
    // Pot.
    ctx.fillStyle = '#C97A4A';
    ctx.beginPath();
    ctx.moveTo(-22, 14);
    ctx.lineTo(22, 14);
    ctx.lineTo(16, 44);
    ctx.lineTo(-16, 44);
    ctx.closePath();
    ctx.fill();
    // Sway with the frame.
    const sway = Math.sin(f.globalFrame / 14) * 0.12;
    ctx.strokeStyle = '#3FA34D';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.save();
    ctx.rotate(sway);
    this.line(ctx, 0, 14, 0, -34);
    ctx.fillStyle = '#4CAF50';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * 14, -20, 16, 9, s * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.restore();
  }

  private drawStar(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    const tw = 0.9 + ((Math.sin(f.globalFrame / 6) + 1) / 2) * 0.2;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(tw, tw);
    ctx.fillStyle = '#FFD93D';
    ctx.strokeStyle = '#C9A227';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 30 : 13;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawSpeechBubble(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#2B2B2B';
    ctx.lineWidth = 4;
    this.roundRect(ctx, -42, -32, 84, 52, 14);
    ctx.fill();
    ctx.stroke();
    // Tail.
    ctx.beginPath();
    ctx.moveTo(-10, 18);
    ctx.lineTo(-22, 36);
    ctx.lineTo(2, 18);
    ctx.closePath();
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    // Animated typing dots.
    ctx.fillStyle = p.accent;
    for (let i = 0; i < 3; i++) {
      const up = Math.sin(f.globalFrame / 5 - i * 0.8) * 3;
      this.dot(ctx, -18 + i * 18, -6 + up, 5);
    }
    ctx.restore();
  }

  private drawArrowUp(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    const rise = Math.sin(f.globalFrame / 8) * 6;
    ctx.save();
    ctx.translate(x, y + rise);
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.lineTo(26, -2);
    ctx.lineTo(10, -2);
    ctx.lineTo(10, 34);
    ctx.lineTo(-10, 34);
    ctx.lineTo(-10, -2);
    ctx.lineTo(-26, -2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2B2B2B';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  }

  private drawCheck(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    const pop = 0.85 + Math.min(1, f.sceneProgress * 2) * 0.15;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pop, pop);
    ctx.fillStyle = '#3FA34D';
    ctx.beginPath();
    ctx.arc(0, 0, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-15, 2);
    ctx.lineTo(-4, 14);
    ctx.lineTo(16, -12);
    ctx.stroke();
    ctx.restore();
  }

  private drawFire(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    const flick = Math.sin(f.globalFrame / 4) * 4;
    ctx.save();
    ctx.translate(x, y);
    const flame = (cx: number, h: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx, 24);
      ctx.quadraticCurveTo(cx - 20, 4, cx - 6, -h + flick);
      ctx.quadraticCurveTo(cx, -h - 6, cx + 6, -h + flick);
      ctx.quadraticCurveTo(cx + 20, 4, cx, 24);
      ctx.fill();
    };
    flame(0, 42, '#FF6B35');
    flame(0, 28, '#FFB454');
    flame(2, 16, '#FFE066');
    ctx.restore();
  }

  private drawGlobe(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#3D84A8';
    ctx.beginPath();
    ctx.arc(0, 0, 32, 0, Math.PI * 2);
    ctx.fill();
    // Rotating meridian to imply spin.
    const w = (Math.sin(f.globalFrame / 20) + 1) / 2;
    ctx.strokeStyle = '#A8E6CF';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, 32 * Math.abs(Math.cos(f.globalFrame / 20)) + 2, 32, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-32, 0);
    ctx.lineTo(32, 0);
    ctx.stroke();
    // Land blobs.
    ctx.fillStyle = '#4CAF50';
    ctx.beginPath();
    ctx.arc(-8 + w * 4, -8, 9, 0, Math.PI * 2);
    ctx.arc(10, 10, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2B2B2B';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 32, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawGear(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((f.globalFrame / 30) % (Math.PI * 2));
    ctx.fillStyle = '#8a93a6';
    const teeth = 8;
    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const r = i % 2 === 0 ? 34 : 24;
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = p.bgBottom;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawRocket(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    const lift = Math.sin(f.globalFrame / 8) * 5;
    ctx.save();
    ctx.translate(x, y - lift);
    // Exhaust flame.
    const flame = 14 + Math.abs(Math.sin(f.globalFrame / 3)) * 14;
    ctx.fillStyle = '#FFB454';
    ctx.beginPath();
    ctx.moveTo(-8, 30);
    ctx.lineTo(0, 30 + flame);
    ctx.lineTo(8, 30);
    ctx.closePath();
    ctx.fill();
    // Body.
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#2B2B2B';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, -38);
    ctx.quadraticCurveTo(18, -10, 14, 30);
    ctx.lineTo(-14, 30);
    ctx.quadraticCurveTo(-18, -10, 0, -38);
    ctx.fill();
    ctx.stroke();
    // Fins + window.
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.moveTo(-14, 14); ctx.lineTo(-26, 32); ctx.lineTo(-14, 30); ctx.closePath();
    ctx.moveTo(14, 14); ctx.lineTo(26, 32); ctx.lineTo(14, 30); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3D84A8';
    this.dot(ctx, 0, -6, 8);
    ctx.restore();
  }

  private drawMoon(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#FFF1B8';
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.bgBottom;
    ctx.beginPath();
    ctx.arc(10, -6, 26, 0, Math.PI * 2);
    ctx.fill();
    // Drifting "Z"s for sleep.
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 22px Sans';
    ctx.textAlign = 'center';
    const zf = (f.globalFrame / 18) % 3;
    ctx.globalAlpha = Math.max(0, 1 - zf / 3);
    ctx.fillText('z', 34, -20 - zf * 14);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawWarning(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    const pulse = 0.6 + ((Math.sin(f.globalFrame / 5) + 1) / 2) * 0.4;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#FFB454';
    ctx.strokeStyle = '#2B2B2B';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.lineTo(34, 26);
    ctx.lineTo(-34, 26);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#2B2B2B';
    ctx.fillRect(-4, -16, 8, 24);
    this.dot(ctx, 0, 16, 5);
    ctx.restore();
  }

  private drawTrophy(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    const shimmer = (Math.sin(f.globalFrame / 6) + 1) / 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#FFD93D';
    ctx.strokeStyle = '#C9A227';
    ctx.lineWidth = 4;
    // Cup.
    ctx.beginPath();
    ctx.moveTo(-22, -28);
    ctx.lineTo(22, -28);
    ctx.lineTo(18, -2);
    ctx.quadraticCurveTo(0, 14, -18, -2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Handles.
    ctx.beginPath();
    ctx.arc(-22, -20, 10, Math.PI * 0.5, Math.PI * 1.5, true);
    ctx.arc(22, -20, 10, Math.PI * 1.5, Math.PI * 0.5, true);
    ctx.stroke();
    // Stem + base.
    ctx.fillStyle = '#C9A227';
    ctx.fillRect(-4, 12, 8, 12);
    ctx.fillRect(-16, 24, 32, 8);
    // Shine.
    ctx.globalAlpha = shimmer * 0.7;
    ctx.fillStyle = '#FFFFFF';
    this.dot(ctx, -8, -16, 4);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private drawMusicNote(f: FrameContext, x: number, y: number, p: Palette): void {
    const { ctx } = f;
    const bob = Math.sin(f.globalFrame / 7) * 5;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.fillStyle = p.ink;
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 5;
    // Stems.
    this.line(ctx, -2, 18, -2, -30);
    this.line(ctx, 26, 10, 26, -38);
    this.line(ctx, -2, -30, 26, -38);
    // Note heads.
    ctx.save();
    ctx.translate(-10, 18); ctx.rotate(-0.4);
    ctx.beginPath(); ctx.ellipse(0, 0, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(18, 10); ctx.rotate(-0.4);
    ctx.beginPath(); ctx.ellipse(0, 0, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  // --- Low-level primitives -------------------------------------------------

  private limb(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    _scale: number,
  ): void {
    ctx.lineWidth = 12;
    this.line(ctx, x1, y1, x2, y2);
  }

  private line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  private dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Shrinks the font until `text` fits within maxWidth (single line). */
  private fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, startPx: number): void {
    let size = startPx;
    ctx.font = `bold ${size}px Sans`;
    while (ctx.measureText(text).width > maxWidth && size > 22) {
      size -= 2;
      ctx.font = `bold ${size}px Sans`;
    }
  }

  /** Word-wraps `text` centered at (cx, y), drawing up to 3 lines. */
  private wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    cx: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
  ): void {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);

    const shown = lines.slice(0, 3);
    if (lines.length > 3) shown[2] = shown[2].replace(/\s+\S*$/, '…');
    shown.forEach((line, i) => ctx.fillText(line, cx, y + i * lineHeight));
  }
}
