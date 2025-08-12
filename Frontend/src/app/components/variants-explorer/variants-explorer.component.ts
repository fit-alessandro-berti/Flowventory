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
  objectIds: string[]; // materials that match this variant
  selected?: boolean;
}

type GraphModel = {
  nodes: { id: string; type: 'event' | 'object'; label: string; tooltip?: string }[];
  edges: { id: string; source: string; target: string; label: string }[];
};

@Component({
  selector: 'app-variants-explorer',
  standalone: true,
  imports: [CommonModule, FormsModule, ActivityStatsOverlayComponent],
  templateUrl: './variants-explorer.component.html',
  styleUrls: ['./variants-explorer.component.scss']
})
export class VariantsExplorerComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly leadObjectType = 'MAT_PLA';

  includeE2OEdges = true; // when off, variants are grouped by pure event sequence
  dfSequenceLength = 2;   // kept for UI parity

  variants: Variant[] = [];
  loading = true;

  statuses: string[] = ['All', 'Normal', 'Understock', 'Overstock'];
  selectedStatus = 'All';

  @ViewChildren('svgContainer') svgContainers!: QueryList<ElementRef<SVGSVGElement>>;

  private ocelData: OCELData | null = null;
  private elk = new ELK();

  private dataSub?: Subscription;
  private viewChangesSub?: Subscription;

  private objectById = new Map<string, OCELObject>();
  private eventsByObject = new Map<string, OCELEvent[]>();
  private readonly statusAttrs = ['Status', 'Current Status'];

  statsObjectIds: string[] | null = null;

  constructor(
    private ocelDataService: OcelDataService,
    private viewState: ViewStateService
  ) {}

  ngOnInit(): void {
    this.dataSub = this.ocelDataService.ocelData$.subscribe(data => {
      if (data) {
        this.ocelData = data;
        this.rebuildIndexes();
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

  /** Build quick lookups for objects and direct events per object */
  private rebuildIndexes(): void {
    if (!this.ocelData) return;

    this.objectById.clear();
    for (const o of this.ocelData.objects) this.objectById.set(o.id, o);

    this.eventsByObject.clear();
    for (const ev of this.ocelData.events) {
      for (const rel of ev.relationships) {
        const list = this.eventsByObject.get(rel.objectId) ?? [];
        list.push(ev);
        this.eventsByObject.set(rel.objectId, list);
      }
    }
    // sort each object's events chronologically
    for (const [, list] of this.eventsByObject) {
      list.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    }
  }

  /** Split event sequence by selected status */
  private segmentByStatus(events: OCELEvent[]): OCELEvent[][] {
    if (this.selectedStatus === 'All') {
      return events.length ? [events] : [];
    }
    const segments: OCELEvent[][] = [];
    let cur: OCELEvent[] = [];
    for (const ev of events) {
      const st = String(ev.attributes.find(a => this.statusAttrs.includes(a.name))?.value || '');
      if (st === this.selectedStatus) cur.push(ev);
      else {
        if (cur.length) segments.push(cur);
        cur = [];
      }
    }
    if (cur.length) segments.push(cur);
    return segments;
  }

  private buildStepsForEvents(evs: OCELEvent[]): VariantStep[] {
    return evs.map(ev => {
      const counts: Record<string, number> = {};
      for (const rel of ev.relationships) {
        const obj = this.objectById.get(rel.objectId);
        if (!obj) continue;
        if (obj.type === this.leadObjectType) continue; // exclude materials from the signature
        counts[obj.type] = (counts[obj.type] || 0) + 1;
      }
      return { eventType: ev.type, objectTypeCounts: counts };
    });
  }

  private stepsSignature(steps: VariantStep[]): string {
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
  }

  /**
   * Variants = ordered sequence of direct material events.
   * Optionally includes attached object TYPE multiset at each step.
   */
  private computeVariants(): void {
    if (!this.ocelData) return;
    this.rebuildIndexes();

    const materials = this.ocelData.objects.filter(o => o.type === this.leadObjectType);
    const variantMap = new Map<string, Variant>();

    for (const mat of materials) {
      const seq = this.eventsByObject.get(mat.id) || [];
      const segments = this.segmentByStatus(seq);

      for (const seg of segments) {
        if (!seg.length) continue;
        const steps = this.buildStepsForEvents(seg);
        const key = this.stepsSignature(steps);
        if (!key) continue;

        const v = variantMap.get(key);
        if (v) v.objectIds.push(mat.id);
        else variantMap.set(key, { key, steps, objectIds: [mat.id] });
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

  /** Find a representative segment (for the first material in the variant) that matches the variant.key */
  private getSampleSegmentForVariant(variant: Variant): { matId: string; events: OCELEvent[] } | null {
    if (!this.ocelData || variant.objectIds.length === 0) return null;

    for (const matId of variant.objectIds) {
      const seq = this.eventsByObject.get(matId) || [];
      const segments = this.segmentByStatus(seq);
      for (const seg of segments) {
        const steps = this.buildStepsForEvents(seg);
        const key = this.stepsSignature(steps);
        if (key === variant.key) {
          return { matId, events: seg };
        }
      }
    }
    return null;
  }

  /**
   * Build a sample graph for the variant using a representative material:
   * - event nodes in order
   * - object nodes unified by object **id** (including the material itself)
   */
  private buildSampleGraphForVariant(variant: Variant): GraphModel | null {
    const match = this.getSampleSegmentForVariant(variant);
    if (!match) return null;

    const { matId, events } = match;

    const nodesMap = new Map<string, { id: string; type: 'event' | 'object'; label: string; tooltip?: string }>();
    const edges: { id: string; source: string; target: string; label: string }[] = [];

    let prevEventId: string | null = null;

    // Ensure lead material node exists (so repeated connections go to the same node)
    const matObj = this.objectById.get(matId);
    if (matObj && this.includeE2OEdges) {
      nodesMap.set(`O_${matObj.id}`, { id: `O_${matObj.id}`, type: 'object', label: matObj.id, tooltip: matObj.type });
    }

    events.forEach((ev, idx) => {
      const eId = `E_${idx}_${ev.id}`;
      nodesMap.set(eId, { id: eId, type: 'event', label: ev.type });

      if (prevEventId) {
        edges.push({ id: `EE_${idx - 1}_${idx}`, source: prevEventId, target: eId, label: '' });
      }
      prevEventId = eId;

      if (this.includeE2OEdges) {
        for (const rel of ev.relationships) {
          const obj = this.objectById.get(rel.objectId);
          if (!obj) continue;

          const oid = `O_${obj.id}`;
          if (!nodesMap.has(oid)) {
            nodesMap.set(oid, { id: oid, type: 'object', label: obj.id, tooltip: obj.type });
          }
          edges.push({ id: `EO_${idx}_${obj.id}`, source: eId, target: oid, label: '' });
        }
      }
    });

    return { nodes: Array.from(nodesMap.values()), edges };
  }

  private wrapLabel(text: string, max = 16): string[] {
    const clean = String(text);
    if (clean.length <= max) return [clean];
    const out: string[] = [];
    let i = 0;
    while (i < clean.length) {
      out.push(clean.slice(i, i + max));
      i += max;
    }
    return out;
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

    const graph = this.buildSampleGraphForVariant(variant);
    if (!graph) {
      svg.innerHTML = '';
      return;
    }

    const nodesWithMetrics = graph.nodes.map(n => ({
      ...n,
      lines: this.wrapLabel(n.label, 14),
      width: n.type === 'event' ? 120 : 110,
      height: n.type === 'event' ? 52 : 40
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
      nodes: { id: string; type: 'event' | 'object'; lines: string[]; width: number; height: number; tooltip?: string }[];
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

      if (info.tooltip) {
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = info.tooltip;
        text.appendChild(title);
      }

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
