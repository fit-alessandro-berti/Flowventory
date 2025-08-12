import {
  Component,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ViewChildren,
  QueryList,
  ElementRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ActivityStatsOverlayComponent } from '../activity-stats-overlay/activity-stats-overlay.component';
import { OcelDataService } from '../../services/ocel-data.service';
import { ViewStateService } from '../../services/view-state.service';
import { OCELData, OCELEvent, OCELObject } from '../../models/ocel.model';
import ELK from 'elkjs/lib/elk.bundled.js';

interface VariantStep {
  eventType: string;
  /** Counts of non-material object types attached to this event */
  objectTypeCounts: Record<string, number>;
}

interface Variant {
  key: string;
  steps: VariantStep[];
  objectIds: string[];
  selected?: boolean;
}

@Component({
  selector: 'app-variants-explorer',
  standalone: true,
  imports: [CommonModule, FormsModule, ActivityStatsOverlayComponent],
  templateUrl: './variants-explorer.component.html',
  styleUrls: ['./variants-explorer.component.scss']
})
export class VariantsExplorerComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly leadObjectType = 'MAT_PLA';

  includeE2OEdges = true; // if false, variants only compare event types (ignores attached objects)
  dfSequenceLength = 2;   // kept in UI; not used in grouping anymore (variants are full sequences)

  variants: Variant[] = [];
  loading = true;

  statuses: string[] = ['All', 'Normal', 'Understock', 'Overstock'];
  selectedStatus = 'All';

  @ViewChildren('svgContainer') svgContainers!: QueryList<ElementRef<SVGSVGElement>>;

  private ocelData: OCELData | null = null;
  private elk = new ELK();

  private dataSub?: Subscription;
  private viewChangesSub?: Subscription;

  statsObjectIds: string[] | null = null;

  constructor(
    private ocelDataService: OcelDataService,
    private viewState: ViewStateService
  ) {}

  ngOnInit(): void {
    this.dataSub = this.ocelDataService.ocelData$.subscribe(data => {
      if (data) {
        this.ocelData = data;
        this.computeVariants();
        this.loading = false;
      }
    });
  }

  ngAfterViewInit(): void {
    this.viewChangesSub = this.svgContainers.changes.subscribe(() => this.renderGraphs());
    if (!this.loading) this.renderGraphs();
  }

  ngOnDestroy(): void {
    this.dataSub?.unsubscribe();
    this.viewChangesSub?.unsubscribe();
  }

  onSettingsUpdate(): void {
    if (this.ocelData) {
      this.computeVariants();
    }
  }

  /**
   * NEW: Object-centric variants based on the DIRECT events of each material.
   * For each event, we capture the set (with multiplicity) of other object TYPES
   * attached to that event (excluding any materials), and use the ordered sequence
   * of these steps as the variant key.
   */
  private computeVariants(): void {
    if (!this.ocelData) return;

    const objectById = new Map<string, OCELObject>();
    this.ocelData.objects.forEach(o => objectById.set(o.id, o));

    // Index: objectId -> events that directly reference it
    const eventsByObject = new Map<string, OCELEvent[]>();
    this.ocelData.events.forEach(ev => {
      ev.relationships.forEach(rel => {
        if (!eventsByObject.has(rel.objectId)) {
          eventsByObject.set(rel.objectId, []);
        }
        eventsByObject.get(rel.objectId)!.push(ev);
      });
    });

    const materials = this.ocelData.objects.filter(o => o.type === this.leadObjectType);
    const statusAttrs = ['Status', 'Current Status'];
    const variantMap = new Map<string, Variant>();

    const buildSteps = (mat: OCELObject, evs: OCELEvent[]): VariantStep[] => {
      return evs.map(ev => {
        const counts: Record<string, number> = {};
        for (const rel of ev.relationships) {
          const obj = objectById.get(rel.objectId);
          if (!obj) continue;
          // Exclude all materials (lead objects) from the per-event attachment profile
          if (obj.type === this.leadObjectType) continue;
          counts[obj.type] = (counts[obj.type] || 0) + 1;
        }
        return { eventType: ev.type, objectTypeCounts: counts };
      });
    };

    const stepsSignature = (steps: VariantStep[]): string => {
      const tokens = steps.map(s => {
        if (!this.includeE2OEdges) return s.eventType;
        const parts = Object.keys(s.objectTypeCounts)
          .sort()
          .map(t => {
            const c = s.objectTypeCounts[t];
            return c > 1 ? `${t}x${c}` : t;
          });
        return parts.length ? `${s.eventType}[${parts.join('+')}]` : s.eventType;
      });
      return tokens.join('->');
    };

    for (const mat of materials) {
      // DIRECT events for the material only (no BFS to other objects!)
      let matEvents = (eventsByObject.get(mat.id) || []).slice();
      matEvents.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

      // Segment by chosen status: "All" keeps the whole sequence; otherwise keep contiguous runs
      const segments: OCELEvent[][] = [];
      if (this.selectedStatus === 'All') {
        if (matEvents.length) segments.push(matEvents);
      } else {
        let cur: OCELEvent[] = [];
        for (const ev of matEvents) {
          const st = String(ev.attributes.find(a => statusAttrs.includes(a.name))?.value || '');
          if (st === this.selectedStatus) cur.push(ev);
          else {
            if (cur.length) segments.push(cur);
            cur = [];
          }
        }
        if (cur.length) segments.push(cur);
      }

      for (const seg of segments) {
        if (!seg.length) continue;
        const steps = buildSteps(mat, seg);
        const key = stepsSignature(steps);

        const existing = variantMap.get(key);
        if (existing) {
          existing.objectIds.push(mat.id);
        } else {
          variantMap.set(key, { key, steps, objectIds: [mat.id] });
        }
      }
    }

    this.variants = Array.from(variantMap.values()).sort(
      (a, b) => b.objectIds.length - a.objectIds.length
    );

    setTimeout(() => this.renderGraphs(), 0);
  }

  applyFilter(): void {
    const selected = this.variants.filter(v => v.selected);
    if (selected.length === 0) return;
    const ids = new Set<string>();
    selected.forEach(v => v.objectIds.forEach(id => ids.add(id)));
    this.ocelDataService.addFilter('Variants Explorer Filter', this.leadObjectType, Array.from(ids));
    this.viewState.setView('sa-ocdfg');
  }

  openStats(variant: Variant): void {
    this.statsObjectIds = variant.objectIds;
  }

  closeStats(): void {
    this.statsObjectIds = null;
  }

  trackByVariant(index: number, v: Variant): string {
    return v.key;
  }

  /** Build a small graph: path of events; each event fans out to its non-material object types. */
  private parseVariant(variant: Variant): {
    nodes: { id: string; type: 'event' | 'object'; label: string }[];
    edges: { id: string; source: string; target: string; label: string }[];
  } {
    const nodes: { id: string; type: 'event' | 'object'; label: string }[] = [];
    const edges: { id: string; source: string; target: string; label: string }[] = [];

    let prevEventId: string | null = null;

    variant.steps.forEach((step, idx) => {
      const eId = `E${idx}_${step.eventType}`;
      nodes.push({ id: eId, type: 'event', label: step.eventType });

      if (prevEventId) {
        edges.push({ id: `EE_${idx - 1}_${idx}`, source: prevEventId, target: eId, label: '' });
      }
      prevEventId = eId;

      if (this.includeE2OEdges) {
        const entries = Object.entries(step.objectTypeCounts);
        for (const [type, cnt] of entries) {
          const oId = `O${idx}_${type}`;
          const oLabel = cnt > 1 ? `${type} × ${cnt}` : type;
          nodes.push({ id: oId, type: 'object', label: oLabel });
          edges.push({ id: `EO_${idx}_${type}`, source: eId, target: oId, label: '' });
        }
      }
    });

    return { nodes, edges };
  }

  private wrapLabel(text: string, max = 14): string[] {
    const clean = text.replace(/_/g, ' ');
    const words = clean.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length <= max) {
        line = (line ? line + ' ' : '') + w;
      } else {
        if (line) lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  private async renderGraphs(): Promise<void> {
    if (!this.svgContainers) return;
    const svgs = this.svgContainers.toArray();
    const promises = this.variants.map((variant, idx) =>
      this.renderVariantGraph(variant, svgs[idx]?.nativeElement)
    );
    await Promise.all(promises);
  }

  private async renderVariantGraph(variant: Variant, svg?: SVGSVGElement): Promise<void> {
    if (!svg) return;
    const graph = this.parseVariant(variant);

    const nodesWithMetrics = graph.nodes.map(n => ({
      ...n,
      lines: this.wrapLabel(n.label, 14),
      width: n.type === 'event' ? 110 : 92,
      height: n.type === 'event' ? 48 : 36
    }));

    const elkGraph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.layered.spacing.nodeNodeBetweenLayers': '40',
        'elk.spacing.nodeNode': '24',
        'elk.edgeRouting': 'ORTHOGONAL'
      },
      children: nodesWithMetrics.map(n => ({
        id: n.id,
        width: n.width,
        height: n.height
      })),
      edges: graph.edges.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] }))
    };

    try {
      const layout = await this.elk.layout(elkGraph);
      this.drawPattern(layout, { nodes: nodesWithMetrics, edges: graph.edges }, svg);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error laying out variant graph:', err);
    }
  }

  private drawPattern(
    layout: any,
    graph: {
      nodes: { id: string; type: 'event' | 'object'; lines: string[]; width: number; height: number }[];
      edges: { id: string; source: string; target: string; label: string }[];
    },
    svg: SVGSVGElement
  ): void {
    svg.innerHTML = '';

    const padding = 20;
    const width = layout.width + 2 * padding;
    const height = layout.height + 2 * padding;

    // Responsive SVG inside the table cell
    svg.setAttribute('viewBox', `${-padding} ${-padding} ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.removeAttribute('width');
    svg.removeAttribute('height');

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'arrow');
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', '0 0, 10 3, 0 6');
    polygon.setAttribute('fill', '#555');
    marker.appendChild(polygon);
    defs.appendChild(marker);
    svg.appendChild(defs);

    const edgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    (layout.edges || []).forEach((edge: any) => {
      const section = edge.sections?.[0];
      if (!section) return;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const points = section.bendPoints || [];
      const start = section.startPoint;
      const end = section.endPoint;
      let d = `M ${start.x} ${start.y}`;
      points.forEach((p: any) => (d += ` L ${p.x} ${p.y}`));
      d += ` L ${end.x} ${end.y}`;
      path.setAttribute('d', d);
      path.setAttribute('stroke', '#555');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      path.setAttribute('marker-end', 'url(#arrow)');
      edgeGroup.appendChild(path);
    });

    svg.appendChild(edgeGroup);

    const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    (layout.children || []).forEach((node: any) => {
      const info = graph.nodes.find(n => n.id === node.id)!;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

      if (info.type === 'object') {
        const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
        ellipse.setAttribute('cx', (node.x + node.width / 2).toString());
        ellipse.setAttribute('cy', (node.y + node.height / 2).toString());
        ellipse.setAttribute('rx', (node.width / 2).toString());
        ellipse.setAttribute('ry', (node.height / 2).toString());
        ellipse.setAttribute('fill', '#fff3e0');
        ellipse.setAttribute('stroke', '#333');
        ellipse.setAttribute('stroke-width', '2');
        g.appendChild(ellipse);
      } else {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', node.x.toString());
        rect.setAttribute('y', node.y.toString());
        rect.setAttribute('width', node.width.toString());
        rect.setAttribute('height', node.height.toString());
        rect.setAttribute('fill', '#e3f2fd');
        rect.setAttribute('stroke', '#333');
        rect.setAttribute('stroke-width', '2');
        rect.setAttribute('rx', '5');
        g.appendChild(rect);
      }

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      const lineHeight = 14;
      const startY = node.y + node.height / 2 - ((info.lines.length - 1) * lineHeight) / 2;
      text.setAttribute('x', (node.x + node.width / 2).toString());
      text.setAttribute('y', startY.toString());
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '12');
      text.setAttribute('fill', '#333');

      info.lines.forEach((line, idx) => {
        const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        tspan.setAttribute('x', (node.x + node.width / 2).toString());
        tspan.setAttribute('dy', idx === 0 ? '0' : '1.2em');
        tspan.textContent = line;
        text.appendChild(tspan);
      });

      g.appendChild(text);
      nodeGroup.appendChild(g);
    });

    svg.appendChild(nodeGroup);
  }
}
