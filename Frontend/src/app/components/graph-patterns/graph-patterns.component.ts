import { Component, OnInit, AfterViewInit, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OcelDataService } from '../../services/ocel-data.service';
import { OCELData, OCELEvent, OCELObject } from '../../models/ocel.model';
import ELK from 'elkjs/lib/elk.bundled.js';

interface GraphPattern {
  edges: string[];
  support: number;
}

@Component({
  selector: 'app-graph-patterns',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './graph-patterns.component.html',
  styleUrl: './graph-patterns.component.scss'
})
export class GraphPatternsComponent implements OnInit, AfterViewInit {
  readonly leadObjectType = 'MAT_PLA';
  minPatternLength = 1;
  maxPatterns = 50;
  /** Maximum number of patterns/candidates considered during mining */
  maxCandidatePatterns = 3000;
  minSupportPercent = 10;
  showProblematicOnly = true;
  includeE2OEdges = true;
  dfSequenceLength = 2;
  patterns: GraphPattern[] = [];
  loading = true;

  @ViewChildren('svgContainer') svgContainers!: QueryList<ElementRef<SVGSVGElement>>;

  private ocelData: OCELData | null = null;
  private elk = new ELK();

  constructor(private ocelDataService: OcelDataService) {}

  ngOnInit(): void {
    this.ocelDataService.ocelData$.subscribe(data => {
      if (data) {
        this.ocelData = data;
        this.computeGraphPatterns();
        this.loading = false;
      }
    });
  }

  ngAfterViewInit(): void {
    if (!this.loading) {
      this.renderGraphs();
    }
  }

  onPatternSettingsUpdate(): void {
    if (this.ocelData) {
      this.computeGraphPatterns();
    }
  }

  private computeGraphPatterns(): void {
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
    const transactions: string[][] = [];

    leadObjects.forEach(mat => {
      const events = (eventsIndex.get(mat.id) || [])
        .slice()
        .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

      const eventsByObject = new Map<string, OCELEvent[]>();
      events.forEach(ev => {
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

      events.forEach((ev, idx) => {
        ev.relationships.forEach(rel => {
          const obj = objectIndex.get(rel.objectId);
          if (!obj) return;
          if (obj.type === this.leadObjectType) return; // skip main object
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
      if (this.showProblematicOnly && !transaction.some(e => e.includes('ST CHANGE'))) {
        return;
      }
      transactions.push(transaction);
    });

    const minSupport = Math.max(
      1,
      Math.ceil(transactions.length * (this.minSupportPercent / 100))
    );
    const mined = this.apriori(transactions, minSupport);
    let filtered = mined.filter(p => p.edges.length >= Math.max(1, this.minPatternLength));
    if (this.showProblematicOnly) {
      filtered = filtered.filter(p => p.edges.some(e => e.includes('ST CHANGE')));
    }
    const sorted = filtered.sort((a, b) => {
      if (b.support !== a.support) {
        return b.support - a.support;
      }
      return b.edges.length - a.edges.length;
    });

    const maximal: GraphPattern[] = [];
    sorted.forEach(p => {
      const isSubset = maximal.some(m => this.isSubset(p.edges, m.edges));
      if (!isSubset) {
        maximal.push(p);
      }
    });

    const limit = Math.max(1, this.maxPatterns);
    this.patterns = maximal.slice(0, limit);
    setTimeout(() => this.renderGraphs(), 50);
  }

  private apriori(transactions: string[][], minSup: number): GraphPattern[] {
    const results: GraphPattern[] = [];
    let k = 1;
    let candidates: string[][] = [];

    // initial candidates
    const itemSet = new Set<string>();
    transactions.forEach(t => t.forEach(i => itemSet.add(i)));
    candidates = Array.from(itemSet).map(i => [i]);
    if (candidates.length > this.maxCandidatePatterns) {
      candidates = candidates.slice(0, this.maxCandidatePatterns);
    }

    while (candidates.length > 0 && results.length < this.maxCandidatePatterns) {
      const counts = new Map<string, number>();
      candidates.forEach(candidate => {
        const key = candidate.slice().sort().join('\u0001');
        counts.set(key, 0);
      });

      transactions.forEach(t => {
        candidates.forEach(candidate => {
          if (candidate.every(item => t.includes(item))) {
            const key = candidate.slice().sort().join('\u0001');
            counts.set(key, (counts.get(key) || 0) + 1);
          }
        });
      });

      const frequent: string[][] = [];
      counts.forEach((count, key) => {
        if (count >= minSup && results.length < this.maxCandidatePatterns) {
          const items = key.split('\u0001');
          frequent.push(items);
          results.push({ edges: items, support: count });
        }
      });

      k++;
      candidates = [];
      for (let i = 0; i < frequent.length && candidates.length < this.maxCandidatePatterns; i++) {
        for (let j = i + 1; j < frequent.length && candidates.length < this.maxCandidatePatterns; j++) {
          const union = Array.from(new Set([...frequent[i], ...frequent[j]]));
          if (union.length === k && !candidates.some(c => this.sameSet(c, union))) {
            candidates.push(union);
          }
        }
      }
    }

    return results;
  }

  private sameSet(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((val, idx) => val === sortedB[idx]);
  }

  private isSubset(sub: string[], sup: string[]): boolean {
    return sub.every(e => sup.includes(e));
  }

  private parsePattern(pattern: GraphPattern): {
    nodes: { id: string; type: string }[];
    edges: { id: string; source: string; target: string; label: string }[];
  } {
    const nodeMap = new Map<string, { id: string; type: string }>();
    const edges: { id: string; source: string; target: string; label: string }[] = [];
    let edgeId = 0;

    pattern.edges.forEach(e => {
      const e2o = /(.*)-->(.*)\(e2o\)/.exec(e);
      if (e2o) {
        const from = e2o[1];
        const to = e2o[2];
        if (!nodeMap.has(from)) nodeMap.set(from, { id: from, type: 'event' });
        if (!nodeMap.has(to)) nodeMap.set(to, { id: to, type: 'object' });
        edges.push({ id: 'e' + edgeId++, source: from, target: to, label: 'e2o' });
        return;
      }

      const df = /(.*)\(df_([^\)]+)\)/.exec(e);
      if (df) {
        const seq = df[1].split('-->');
        for (let i = 0; i < seq.length - 1; i++) {
          const a = seq[i];
          const b = seq[i + 1];
          if (!nodeMap.has(a)) nodeMap.set(a, { id: a, type: 'event' });
          if (!nodeMap.has(b)) nodeMap.set(b, { id: b, type: 'event' });
          edges.push({ id: 'e' + edgeId++, source: a, target: b, label: `df_${df[2]}` });
        }
      }
    });

    return { nodes: Array.from(nodeMap.values()), edges };
  }

  private splitLabel(text: string, maxLen: number): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    words.forEach(word => {
      if ((current + ' ' + word).trim().length > maxLen) {
        if (current) lines.push(current);
        if (word.length > maxLen) {
          const chunks = word.match(new RegExp(`.{1,${maxLen}}`, 'g')) || [];
          lines.push(...chunks);
          current = '';
        } else {
          current = word;
        }
      } else {
        current = current ? `${current} ${word}` : word;
      }
    });
    if (current) lines.push(current);
    return lines;
  }

  private async renderGraphs(): Promise<void> {
    if (!this.svgContainers) return;
    const containers = this.svgContainers.toArray();
    for (let i = 0; i < this.patterns.length && i < containers.length; i++) {
      await this.renderPatternGraph(this.patterns[i], containers[i].nativeElement);
    }
  }

  private async renderPatternGraph(pattern: GraphPattern, svg: SVGSVGElement): Promise<void> {
    const graph = this.parsePattern(pattern);
    if (graph.nodes.length === 0) return;

    const nodesWithMetrics = graph.nodes.map(n => {
      const lines = this.splitLabel(n.id, 12);
      const maxChars = Math.max(...lines.map(l => l.length));
      const width = Math.max(60, maxChars * 8 + 16);
      const height = lines.length * 16 + 16;
      return { ...n, lines, width, height };
    });

    const elkGraph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
        'elk.spacing.nodeNode': '60'
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
      console.error('Error laying out pattern graph:', err);
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
