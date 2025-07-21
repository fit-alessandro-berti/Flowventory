import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OcelDataService } from '../../services/ocel-data.service';
import { ViewStateService } from '../../services/view-state.service';
import { OCELData } from '../../models/ocel.model';

interface PatternResult {
  sequence: string[];
  support: number;
}

interface PatternDisplay extends PatternResult {
  immediate: boolean[];
  objectIds: string[];
  selected?: boolean;
}

@Component({
  selector: 'app-lifecycle-patterns',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './lifecycle-patterns.component.html',
  styleUrl: './lifecycle-patterns.component.scss'
})
export class LifecyclePatternsComponent implements OnInit {
  objectTypes: string[] = [];
  leadObjectType = 'MAT_PLA';
  patterns: PatternDisplay[] = [];
  loading = true;
  minPatternLength = 1;
  maxPatterns = 50;
  prefilterProblematic = true;
  postfilterProblematic = false;

  statuses: string[] = ['All', 'Normal', 'Understock', 'Overstock'];
  selectedStatus = 'All';

  private ocelData: OCELData | null = null;
  private sequencesByObject = new Map<string, string[][]>();

  activityStats: { activity: string; count: number; percent: number }[] | null = null;

  statsTotal = 0;

  constructor(
    private ocelDataService: OcelDataService,
    private viewState: ViewStateService
  ) {}

  ngOnInit(): void {
    this.ocelDataService.ocelData$.subscribe(data => {
      if (data) {
        this.ocelData = data;
        this.objectTypes = data.objectTypes.map(t => t.name);
        if (!this.objectTypes.includes('MAT_PLA') && this.objectTypes.length > 0) {
          this.leadObjectType = this.objectTypes[0];
        }
        this.computePatterns();
        this.loading = false;
      }
    });
  }

  onLeadObjectTypeChange(): void {
    if (this.ocelData) {
      this.computePatterns();
    }
  }

  onPatternSettingsUpdate(): void {
    if (this.ocelData) {
      this.computePatterns();
    }
  }

  private computePatterns(): void {
    if (!this.ocelData) return;

    const sequences: string[][] = [];
    this.sequencesByObject.clear();
    const leadObjects = this.ocelData.objects.filter(o => o.type === this.leadObjectType);
    const statusAttrs = ['Status', 'Current Status'];

    const addSeq = (id: string, seq: string[]) => {
      if (this.prefilterProblematic && !seq.some(t => t.startsWith('ST CHANGE'))) return;
      sequences.push(seq);
      if (!this.sequencesByObject.has(id)) {
        this.sequencesByObject.set(id, []);
      }
      this.sequencesByObject.get(id)!.push(seq);
    };

    leadObjects.forEach(obj => {
      const objEvents = this.ocelData!.events
        .filter(e => e.relationships.some(r => r.objectId === obj.id))
        .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

      if (objEvents.length === 0) return;

      if (this.selectedStatus === 'All') {
        const seq = objEvents.map(e => e.type);
        addSeq(obj.id, seq);
      } else {
        let current: string[] = [];
        objEvents.forEach(ev => {
          const st = String(ev.attributes.find(a => statusAttrs.includes(a.name))?.value || '');
          if (st === this.selectedStatus) {
            current.push(ev.type);
          } else {
            if (current.length) {
              addSeq(obj.id, current);
              current = [];
            }
          }
        });
        if (current.length) addSeq(obj.id, current);
      }
    });

    if (sequences.length === 0) {
      this.patterns = [];
      return;
    }

    const minSupport = Math.max(1, Math.ceil(sequences.length * 0.1));
    const results: PatternResult[] = [];
    this.prefixSpan(sequences, [], minSupport, results);
    let filtered = results.filter(r => r.sequence.length >= Math.max(1, this.minPatternLength));
    if (this.postfilterProblematic) {
      filtered = filtered.filter(r => r.sequence.some(act => act.startsWith('ST CHANGE')));
    }
    const sorted = filtered.sort((a, b) => b.support - a.support);
    const limit = Math.max(1, this.maxPatterns);
    this.patterns = sorted.slice(0, limit).map(p => ({
      ...p,
      immediate: this.getImmediateRelations(p.sequence, sequences),
      objectIds: this.getObjectsForPattern(p.sequence),
      selected: false
    }));
  }

  private getImmediateRelations(pattern: string[], sequences: string[][]): boolean[] {
    const relations: boolean[] = [];
    for (let i = 0; i < pattern.length - 1; i++) {
      const a = pattern[i];
      const b = pattern[i + 1];
      let immediate = false;
      outer: for (const seq of sequences) {
        for (let idx = 0; idx < seq.length - 1; idx++) {
          if (seq[idx] === a) {
            const nextIdx = seq.indexOf(b, idx + 1);
            if (nextIdx !== -1) {
              if (nextIdx === idx + 1) {
                immediate = true;
              }
              break outer;
            }
          }
        }
      }
      relations.push(immediate);
    }
    return relations;
  }

  private prefixSpan(db: string[][], prefix: string[], minSup: number, results: PatternResult[]): void {
    const itemCounts = new Map<string, number>();

    db.forEach(seq => {
      const seen = new Set<string>();
      for (let i = 0; i < seq.length; i++) {
        const item = seq[i];
        if (!seen.has(item)) {
          seen.add(item);
          itemCounts.set(item, (itemCounts.get(item) || 0) + 1);
        }
      }
    });

    itemCounts.forEach((count, item) => {
      if (count >= minSup) {
        const newPrefix = [...prefix, item];
        results.push({ sequence: newPrefix, support: count });

        const projected: string[][] = [];
        db.forEach(seq => {
          for (let i = 0; i < seq.length; i++) {
            if (seq[i] === item) {
              projected.push(seq.slice(i + 1));
              break;
            }
          }
        });

        if (projected.length > 0) {
          this.prefixSpan(projected, newPrefix, minSup, results);
        }
      }
    });
  }

  private getObjectsForPattern(pattern: string[]): string[] {
    const ids: string[] = [];
    this.sequencesByObject.forEach((seqs, id) => {
      if (seqs.some(seq => this.isSubsequence(pattern, seq))) {
        ids.push(id);
      }
    });
    return ids;
  }

  private isSubsequence(pattern: string[], sequence: string[]): boolean {
    let idx = 0;
    for (const item of sequence) {
      if (item === pattern[idx]) {
        idx++;
        if (idx === pattern.length) return true;
      }
    }
    return false;
  }

  applyFilter(): void {
    const selected = this.patterns.filter(p => p.selected);
    if (selected.length === 0) return;
    const ids = new Set<string>();
    selected.forEach(p => p.objectIds.forEach(id => ids.add(id)));
    this.ocelDataService.addFilter('Lifecycle Patterns Filter', this.leadObjectType, Array.from(ids));
    this.viewState.setView('sa-ocdfg');
  }

  openStats(pattern: PatternDisplay): void {
    if (!this.ocelData) return;
    const counts = new Map<string, number>();
    this.ocelData.events.forEach(ev => {
      if (ev.relationships.some(r => pattern.objectIds.includes(r.objectId))) {
        counts.set(ev.type, (counts.get(ev.type) || 0) + 1);
      }
    });
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    this.activityStats = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([activity, count]) => ({
        activity,
        count,
        percent: total ? (count / total) * 100 : 0
      }));
    this.statsTotal = total;
  }

  closeStats(): void {
    this.activityStats = null;
  }
}

