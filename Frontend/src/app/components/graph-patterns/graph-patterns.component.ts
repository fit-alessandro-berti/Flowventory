import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OcelDataService } from '../../services/ocel-data.service';
import { OCELData, OCELEvent, OCELObject } from '../../models/ocel.model';

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
export class GraphPatternsComponent implements OnInit {
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

  private ocelData: OCELData | null = null;

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
}
