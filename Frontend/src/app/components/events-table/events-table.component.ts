import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OcelDataService } from '../../services/ocel-data.service';
import { OCELEvent, OCELData } from '../../models/ocel.model';

interface EventTableRow {
  id: string;
  activity: string;
  timestamp: string;
  objectsByType: { [key: string]: string[] };
}

@Component({
  selector: 'app-events-table',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './events-table.component.html',
  styleUrl: './events-table.component.scss'
})
export class EventsTableComponent implements OnInit {
  events: EventTableRow[] = [];
  objectTypes: string[] = [];
  loading = true;

  constructor(private ocelDataService: OcelDataService) {}

  ngOnInit(): void {
    this.ocelDataService.ocelData$.subscribe(data => {
      if (data) {
        this.processEventData(data);
        this.loading = false;
      }
    });
  }

  private processEventData(data: OCELData): void {
    this.objectTypes = data.objectTypes.map(type => type.name);
    
    this.events = data.events.map(event => {
      const row: EventTableRow = {
        id: event.id,
        activity: event.type,
        timestamp: this.formatTimestamp(event.time),
        objectsByType: {}
      };

      // Initialize empty arrays for each object type
      this.objectTypes.forEach(type => {
        row.objectsByType[type] = [];
      });

      // Group objects by type
      event.relationships.forEach(rel => {
        const object = data.objects.find(obj => obj.id === rel.objectId);
        if (object) {
          if (!row.objectsByType[object.type]) {
            row.objectsByType[object.type] = [];
          }
          row.objectsByType[object.type].push(object.id);
        }
      });

      return row;
    });
  }

  private formatTimestamp(timestamp: string): string {
    return new Date(timestamp).toLocaleString();
  }

  getObjectsDisplay(objects: string[]): string {
    return objects.length > 0 ? objects.join(', ') : '-';
  }
}
