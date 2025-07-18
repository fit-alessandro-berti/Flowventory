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
  minSupportPercent = 10;
  showProblematicOnly = false;
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

    const leadObjects = this.ocelData.objects.filter(o => o.type === this.leadObjectType);
    const transactions: string[][] = [];

    leadObjects.forEach(mat => {
      const events = this.ocelData!.events
        .filter(e => e.relationships.some(r => r.objectId === mat.id))
        .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

      const edges: string[] = [];
      const objectLabels = new Map<string, string>();
      const objectCounters: { [type: string]: number } = {};

      events.forEach((ev, idx) => {
        ev.relationships.forEach(rel => {
          const obj = this.ocelData!.objects.find(o => o.id === rel.objectId);
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
            edges.push(`${ev.type}-->${label}(e2o)`);
          }
        });
      });

      const involvedObjects: { id: string; type: string }[] = [{ id: mat.id, type: 'MAT_PLA' }];
      objectLabels.forEach((label, id) => {
        const obj = this.ocelData!.objects.find(o => o.id === id)!;
        involvedObjects.push({ id: obj.id, type: obj.type });
      });

      involvedObjects.forEach(objInfo => {
        const objEvents = events
          .filter(e => e.relationships.some(r => r.objectId === objInfo.id))
          .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
        for (let i = 0; i < objEvents.length - 1; i++) {
          const a = objEvents[i].type;
          const b = objEvents[i + 1].type;
          edges.push(`${a}-->${b}(df_${objInfo.type})`);
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
    const sorted = filtered.sort((a, b) => b.support - a.support);
    const limit = Math.max(1, this.maxPatterns);
    this.patterns = sorted.slice(0, limit);
  }

  private apriori(transactions: string[][], minSup: number): GraphPattern[] {
    const results: GraphPattern[] = [];
    let k = 1;
    let candidates: string[][] = [];

    // initial candidates
    const itemSet = new Set<string>();
    transactions.forEach(t => t.forEach(i => itemSet.add(i)));
    candidates = Array.from(itemSet).map(i => [i]);

    while (candidates.length > 0) {
      const counts = new Map<string, number>();
      candidates.forEach(candidate => {
        const key = candidate.sort().join('\u0001');
        counts.set(key, 0);
      });

      transactions.forEach(t => {
        candidates.forEach(candidate => {
          if (candidate.every(item => t.includes(item))) {
            const key = candidate.sort().join('\u0001');
            counts.set(key, (counts.get(key) || 0) + 1);
          }
        });
      });

      const frequent: string[][] = [];
      counts.forEach((count, key) => {
        if (count >= minSup) {
          const items = key.split('\u0001');
          frequent.push(items);
          results.push({ edges: items, support: count });
        }
      });

      k++;
      candidates = [];
      for (let i = 0; i < frequent.length; i++) {
        for (let j = i + 1; j < frequent.length; j++) {
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
}
