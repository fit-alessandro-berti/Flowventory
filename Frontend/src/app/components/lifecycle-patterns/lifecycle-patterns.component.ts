import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { OcelDataService } from '../../services/ocel-data.service';
import { OCELData, OCELEvent } from '../../models/ocel.model';

interface PatternResult {
  sequence: string[];
  support: number;
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
  patterns: PatternResult[] = [];
  loading = true;

  private ocelData: OCELData | null = null;

  constructor(private ocelDataService: OcelDataService) {}

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

  private computePatterns(): void {
    if (!this.ocelData) return;

    // Build sequences of activities per lead object
    const sequences: string[][] = [];
    const leadObjects = this.ocelData.objects.filter(o => o.type === this.leadObjectType);

    leadObjects.forEach(obj => {
      const objEvents = this.ocelData!.events
        .filter(e => e.relationships.some(r => r.objectId === obj.id))
        .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
      if (objEvents.length > 0) {
        sequences.push(objEvents.map(e => e.type));
      }
    });

    if (sequences.length === 0) {
      this.patterns = [];
      return;
    }

    const minSupport = Math.max(2, Math.ceil(sequences.length * 0.2));
    const results: PatternResult[] = [];
    this.prefixSpan(sequences, [], minSupport, results);
    this.patterns = results.sort((a, b) => b.support - a.support);
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
}

