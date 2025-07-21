import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OcelDataService } from '../../services/ocel-data.service';
import { OCELData } from '../../models/ocel.model';

@Component({
  selector: 'app-activity-stats-overlay',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './activity-stats-overlay.component.html',
  styleUrl: './activity-stats-overlay.component.scss'
})
export class ActivityStatsOverlayComponent implements OnInit, OnChanges {
  @Input() objectIds: string[] | null = null;
  @Output() close = new EventEmitter<void>();

  activityStats: { activity: string; count: number; percent: number }[] = [];
  total = 0;

  private ocelData: OCELData | null = null;

  constructor(private ocelDataService: OcelDataService) {
    this.ocelDataService.ocelData$.subscribe(data => {
      this.ocelData = data;
      this.computeStats();
    });
  }

  ngOnInit(): void {
    this.computeStats();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['objectIds']) {
      this.computeStats();
    }
  }

  private computeStats(): void {
    if (!this.ocelData || !this.objectIds || this.objectIds.length === 0) {
      this.activityStats = [];
      this.total = 0;
      return;
    }
    const counts = new Map<string, number>();
    this.ocelData.events.forEach(ev => {
      if (ev.relationships.some(r => this.objectIds!.includes(r.objectId))) {
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
    this.total = total;
  }

  onClose(): void {
    this.close.emit();
  }
}
