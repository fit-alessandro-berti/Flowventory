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

interface Variant {
  edges: string[];
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
  includeE2OEdges = true;
  dfSequenceLength = 2;
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
    // Render when DOM nodes (svgs) are available or change
    this.viewChangesSub = this.svgContainers.changes.subscribe(() => {
      this.renderGraphs();
    });

    if (!this.loading) {
      // If data already present by now, render once
      this.renderGraphs();
    }
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

  /** Groups materials (lead objects) that share the same object-centric variant */
  private computeVariants(): void {
    if (!this.ocelData) return;

    const objectIndex = new Map<string, OCELObject>();
    this.ocelData.objects.forEach(o => objectIndex.set(o.id, o));

    // objectId -> events touching it
    const eventsIndex = new Map<string, OCELEvent[]>();
    this.ocelData.events.forEach(ev => {
      ev.relationships.forEach(rel => {
        if (!eventsIndex.has(rel.objectId)) {
          eventsIndex.set(rel.objectId, []);
        }
        eventsIndex.get(rel.objectId)!.push(ev);
      });
    });

    const leadObjects = this.ocelData.objects.filter(o => o.type === this.leadObjectType);
    const statusAttrs = ['Status', 'Current Status'];
    const variantMap = new Map<string, Variant>();

    const allowedE2O = new Set(['PO_ITEM', 'SO_ITEM', 'SUPPLIER', this.leadObjectType]);

    for (const mat of leadObjects) {
      // Pull the connected component around this material
      const visitedObjects = new Set<string>([mat.id]);
      const eventMap = new Map<string, OCELEvent>();
      const queue: string[] = [mat.id];

      while (queue.length) {
        const oid = queue.shift()!;
        const relatedEvents = eventsIndex.get(oid) || [];
        for (const ev of relatedEvents) {
          if (!eventMap.has(ev.id)) {
            eventMap.set(ev.id, ev);
            for (const rel of ev.relationships) {
              if (!visitedObjects.has(rel.objectId)) {
                visitedObjects.add(rel.objectId);
                queue.push(rel.objectId);
              }
            }
          }
        }
      }

      const allEvents = Array.from(eventMap.values()).sort(
        (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
      );

      // Segment by status if requested
      const segments: OCELEvent[][] = [];
      if (this.selectedStatus === 'All') {
        if (allEvents.length) segments.push(allEvents);
      } else {
        let current: OCELEvent[] = [];
        for (const ev of allEvents) {
          const st = String(ev.attributes.find(a => statusAttrs.includes(a.name))?.value || '');
          if (st === this.selectedStatus) {
            current.push(ev);
          } else {
            if (current.length) {
              segments.push(current);
              current = [];
            }
          }
        }
        if (current.length) segments.push(current);
      }

      // Build variant features for each segment
      for (const segEvents of segments) {
        // Object -> its events (preserving global chronological order)
        const eventsByObject = new Map<string, OCELEvent[]>();
        for (const ev of segEvents) {
          for (const rel of ev.relationships) {
            if (!eventsByObject.has(rel.objectId)) {
              eventsByObject.set(rel.objectId, []);
            }
            eventsByObject.get(rel.objectId)!.push(ev);
          }
        }

        const edges: string[] = [];

        // Canonical e2o edges by object TYPE (object-centric & grouping-friendly)
        if (this.includeE2OEdges) {
          for (const ev of segEvents) {
            for (const rel of ev.relationships) {
              const obj = objectIndex.get(rel.objectId);
              if (!obj) continue;
              if (!allowedE2O.has(obj.type)) continue;
              // Event-to-objectType edge, not per-object instance
              edges.push(`${ev.type}-->${obj.type}(e2o)`);
            }
          }
        }

        // Determine all objects involved in the segment (by id and their type)
        const involvedObjects: { id: string; type: string }[] = [];
        for (const oid of eventsByObject.keys()) {
          const obj = objectIndex.get(oid);
          if (obj) involvedObjects.push({ id: oid, type: obj.type });
        }
        // Ensure the lead material is included even if it had no direct events in this segment
        if (!involvedObjects.some(o => o.id === mat.id)) {
          involvedObjects.push({ id: mat.id, type: this.leadObjectType });
        }

        // DF n-grams per object TYPE (object-centric)
        for (const objInfo of involvedObjects) {
          const objEvents = eventsByObject.get(objInfo.id) || [];
          if (objEvents.length >= this.dfSequenceLength) {
            for (let i = 0; i <= objEvents.length - this.dfSequenceLength; i++) {
              const seq = objEvents
                .slice(i, i + this.dfSequenceLength)
                .map(e => e.type)
                .join('-->');
              edges.push(`${seq}(df_${objInfo.type})`);
            }
          }
        }

        // Global DF n-grams across all events in the segment (optional but useful)
        if (segEvents.length >= this.dfSequenceLength) {
          for (let i = 0; i <= segEvents.length - this.dfSequenceLength; i++) {
            const seq = segEvents
              .slice(i, i + this.dfSequenceLength)
              .map(e => e.type)
              .join('-->');
            edges.push(`${seq}(df_GLOBAL)`);
          }
        }

        // Canonical transaction (unique + sorted)
        const transaction = Array.from(new Set(edges));
        const key = transaction.slice().sort().join('|');

        const v = variantMap.get(key);
        if (v) {
          v.objectIds.push(mat.id);
        } else {
          variantMap.set(key, { edges: transaction, objectIds: [mat.id] });
        }
      }
    }

    this.variants = Array.from(variantMap.values()).sort(
      (a, b) => b.objectIds.length - a.objectIds.length
    );

    // Draw once the DOM updates with new svgs
    setTimeout(() => this.renderGraphs(), 0);
  }

  applyFilter(): void {
    const selected = this.variants.filter(p => p.selected);
    if (selected.length === 0) return;
    const ids = new Set<string>();
    selected.forEach(p => p.objectIds.forEach(id => ids.add(id)));
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
    // A stable key for the variant card
    return v.edges.slice().sort().join('|');
  }

  /** Parses a variant’s canonical features into a graph model for drawing */
  private parseVariant(variant: Variant): {
    nodes: { id: string; type: 'event' | 'object' }[];
    edges: { id: string; source: string; target: string; label: string }[];
  } {
    const nodesMap = new Map<string, { id: string; type: 'event' | 'object' }>();
    const edges: { id: string; source: string; target: string; label: string }[] = [];

    for (const feat of variant.edges) {
      // robust split "base(type)"
      const openIdx = feat.lastIndexOf('(');
      if (openIdx === -1 || !feat.endsWith(')')) continue;
      const base = feat.slice(0, openIdx);
      const t = feat.slice(openIdx + 1, -1); // drop ")"

      if (t.startsWith('df_')) {
        const objType = t.substring(3); // after "df_"
        const steps = base.split('-->');
        // Expand n-gram into pairwise edges for visualization
        for (let i = 0; i < steps.length - 1; i++) {
          const src = objType === 'GLOBAL' ? steps[i] : `${steps[i]}_${objType}`;
          const tgt = objType === 'GLOBAL' ? steps[i + 1] : `${steps[i + 1]}_${objType}`;

          nodesMap.set(src, { id: src, type: 'event' });
          nodesMap.set(tgt, { id: tgt, type: 'event' });

          edges.push({
            id: `${feat}#${i}`, // ensure unique id per expanded edge
            source: src,
            target: tgt,
            label: objType === 'GLOBAL' ? '' : objType
          });
        }
      } else if (t === 'e2o') {
        // base is "EventType-->ObjectType"
        const [evType, objType] = base.split('-->');
        if (!evType || !objType) continue;

        const evId = `${evType}_${objType}`;

        nodesMap.set(evId, { id: evId, type: 'event' });
        nodesMap.set(objType, { id: objType, type: 'object' });

        edges.push({
          id: feat,
          source: evId,
          target: objType,
          label: ''
        });
      }
    }

    return {
      nodes: Array.from(nodesMap.values()),
      edges
    };
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
      // show only the event name before "_TYPE" to keep cards compact
      lines: [n.type === 'event' ? n.id.replace(/_.*/, '') : n.id],
      width: 92,
      height: 44
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
        height: n.height,
        labels: [{ text: n.id }]
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
    svg.setAttribute('viewBox', `${-padding} ${-padding} ${width} ${height}`);
    svg.setAttribute('width', `${width}`);
    svg.setAttribute('height', `${height}`);

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

    layout.edges.forEach((edge: any) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const section = edge.sections[0];
      const points = section.bendPoints || [];
      const start = section.startPoint;
      const end = section.endPoint;
      let d = `M ${start.x} ${start.y}`;
      points.forEach((p: any) => {
        d += ` L ${p.x} ${p.y}`;
      });
      d += ` L ${end.x} ${end.y}`;
      path.setAttribute('d', d);
      path.setAttribute('stroke', '#555');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      path.setAttribute('marker-end', 'url(#arrow)');

      const label = graph.edges.find(e => e.id === edge.id)?.label || '';
      if (label) {
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = label;
        path.appendChild(title);
      }

      edgeGroup.appendChild(path);
    });

    svg.appendChild(edgeGroup);

    const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    layout.children.forEach((node: any) => {
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
