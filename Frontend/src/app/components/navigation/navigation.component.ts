import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OcelDataService } from '../../services/ocel-data.service';

@Component({
  selector: 'app-navigation',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './navigation.component.html',
  styleUrl: './navigation.component.scss'
})
export class NavigationComponent {
  @Output() itemSelected = new EventEmitter<string>();

  filters: { id: number; objectType: string; objectIds: string[] }[] = [];

  constructor(private ocelDataService: OcelDataService) {
    this.ocelDataService.filters$.subscribe(f => (this.filters = f));
  }

  removeFilter(id: number): void {
    this.ocelDataService.removeFilter(id);
  }
  
  menuItems = [
    { label: 'Events', route: 'events', icon: '📋' },
    { label: 'SA-OCDFG', route: 'sa-ocdfg', icon: '🔀' },
    { label: 'Causal Explorer', route: 'causal-explorer', icon: '🔍' },
    { label: 'Lifecycle Patterns', route: 'lifecycle-patterns', icon: '🧩' },
    { label: 'Graph Patterns', route: 'graph-patterns', icon: '📈' },
    { label: 'Event Context', route: 'event-context', icon: '📊' }
  ];

  activeItem = 'events';

  selectItem(item: string): void {
    this.activeItem = item;
    this.itemSelected.emit(item);
  }
}
