import { Component, OnInit, AfterViewInit, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
  styleUrl: './variants-explorer.component.scss'
})
export class VariantsExplorerComponent implements OnInit, AfterViewInit {
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

  statsObjectIds: string[] | null = null;

  constructor(
    private ocelDataService: OcelDataService,
    private viewState: ViewStateService
  ) {}

  ngOnInit(): void {
    this.ocelDataService.ocelData$.subscribe(data => {
      if (data) {
        this.ocelData = data;
        this.computeVariants();
        this.loading = false;
      }
    });
  }

  ngAfterViewInit(): void {
    if (!this.loading) {
      this.renderGraphs();
    }
  }

  onSettingsUpdate(): void {
    if (this.ocelData) {
      this.computeVariants();
    }
  }

  private computeVariants(): void {
    if (!this.ocelData) return;
    const objectIndex = new Map<string, OCELObject>();
    this.ocelData.objects.forEach(o => objectIndex.set(o.id, o));

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

    leadObjects.forEach(mat => {
      const allEvents = (eventsIndex.get(mat.id) || [])
        .slice()
        .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

      const segments: OCELEvent[][] = [];
      if (this.selectedStatus === 'All') {
        if (allEvents.length) segments.push(allEvents);
      } else {
        let current: OCELEvent[] = [];
        allEvents.forEach(ev => {
          const st = String(ev.attributes.find(a => statusAttrs.includes(a.name))?.value || '');
          if (st === this.selectedStatus) {
            current.push(ev);
          } else {
            if (current.length) {
              segments.push(current);
              current = [];
            }
          }
        });
        if (current.length) segments.push(current);
      }

      segments.forEach(segEvents => {
        const eventsByObject = new Map<string, OCELEvent[]>();
        segEvents.forEach(ev => {
          ev.relationships.forEach(rel => {
            if (!eventsByObject.has(rel.objectId)) {
              eventsByObject.set(rel.objectId, []);
            }
            eventsByObject.get(rel.objectId)!.push(ev);
          });
        });

        const edges: string[] = [];
        const objectLabels = new Map<string, string>();
        const objectCounters: { [type: string]: number } = {};

        segEvents.forEach(ev => {
          ev.relationships.forEach(rel => {
            const obj = objectIndex.get(rel.objectId);
            if (!obj) return;
            if (obj.type === this.leadObjectType) return;
            if (obj.type === 'PO_ITEM' || obj.type === 'SO_ITEM' || obj.type === 'SUPPLIER') {
              if (!objectLabels.has(obj.id)) {
                const count = (objectCounters[obj.type] || 0) + 1;
                objectCounters[obj.type] = count;
                const baseLabel = obj.type === 'SUPPLIER' ? obj.id : `${obj.type}${count}`;
                objectLabels.set(obj.id, baseLabel);
              }
              const label = objectLabels.get(obj.id)!;
              if (this.includeE2OEdges) {
                edges.push(`${ev.type}-->${label}(e2o)`);
              }
            }
          });
        });

        const involvedObjects: { id: string; type: string }[] = [{ id: mat.id, type: 'MAT_PLA' }];
        objectLabels.forEach((label, id) => {
          const obj = objectIndex.get(id)!;
          involvedObjects.push({ id: obj.id, type: obj.type });
        });

        involvedObjects.forEach(objInfo => {
          const objEvents = eventsByObject.get(objInfo.id) || [];
          for (let i = 0; i <= objEvents.length - this.dfSequenceLength; i++) {
            const seq = objEvents
              .slice(i, i + this.dfSequenceLength)
              .map(e => e.type)
              .join('-->');
            edges.push(`${seq}(df_${objInfo.type})`);
          }
        });

        const transaction = Array.from(new Set(edges));
        const key = transaction.slice().sort().join('|');
        if (!variantMap.has(key)) {
          variantMap.set(key, { edges: transaction, objectIds: [mat.id] });
        } else {
          variantMap.get(key)!.objectIds.push(mat.id);
        }
      });
    });

    this.variants = Array.from(variantMap.values()).sort(
      (a, b) => b.objectIds.length - a.objectIds.length
    );
    setTimeout(() => this.renderGraphs(), 50);
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

  private parseVariant(variant: Variant): {
    nodes: { id: string; type: string }[];
    edges: { id: string; source: string; target: string; label: string }[];
  } {
    const nodesMap = new Map<string, { id: string; type: string }>();
    const edges: { id: string; source: string; target: string; label: string }[] = [];

    variant.edges.forEach(e => {
      const [base, type] = e.split('(');
      const t = type.slice(0, -1);
      if (t.startsWith('df_')) {
        const objType = t.replace('df_', '');
        const [src, tgt] = base.split('-->');
        const srcId = `${src}_${objType}`;
        const tgtId = `${tgt}_${objType}`;
        nodesMap.set(srcId, { id: srcId, type: 'event' });
        nodesMap.set(tgtId, { id: tgtId, type: 'event' });
        edges.push({
          id: e,
          source: srcId,
          target: tgtId,
          label: objType
        });
      } else if (t === 'e2o') {
        const [evType, objLabel] = base.split('-->');
        const objId = objLabel;
        const evId = `${evType}_${objId}`;
        nodesMap.set(evId, { id: evId, type: 'event' });
        nodesMap.set(objId, { id: objId, type: 'object' });
        edges.push({
          id: e,
          source: evId,
          target: objId,
          label: ''
        });
      }
    });

    return {
      nodes: Array.from(nodesMap.values()),
      edges
    };
  }

  private async renderGraphs(): Promise<void> {
    if (!this.svgContainers) return;
    const promises = this.variants.map((variant, idx) =>
      this.renderVariantGraph(variant, this.svgContainers.toArray()[idx].nativeElement)
    );
    await Promise.all(promises);
  }

  private async renderVariantGraph(variant: Variant, svg: SVGSVGElement): Promise<void> {
    const graph = this.parseVariant(variant);

    const nodesWithMetrics = graph.nodes.map(n => ({
      ...n,
      lines: [n.id.replace(/_.*/, '')],
      width: 80,
      height: 40
    }));

    const elkGraph = {
      id: 'root',
      layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT' },
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
      console.error('Error laying out variant graph:', err);
    }
  }

  private drawPattern(
    layout: any,
    graph: {
      nodes: { id: string; type: string; lines: string[]; width: number; height: number }[];
      edges: { id: string; source: string; target: string; label: string }[];
    },
    svg: SVGSVGElement
  ): void {
    svg.innerHTML = '';

    const padding = 20;
    const width = layout.width + 2 * padding;
    const height = layout.height + 2 * padding;
    svg.setAttribute('viewBox', `${-padding} ${-padding} ${width} ${height}`);
    svg.setAttribute('width', width.toString());
    svg.setAttribute('height', height.toString());

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
      const points = edge.sections[0].bendPoints || [];
      const start = edge.sections[0].startPoint;
      const end = edge.sections[0].endPoint;
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

