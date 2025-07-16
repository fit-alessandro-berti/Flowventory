import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-navigation',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './navigation.component.html',
  styleUrl: './navigation.component.scss'
})
export class NavigationComponent {
  @Output() itemSelected = new EventEmitter<string>();
  
  menuItems = [
    { label: 'Events', route: 'events', icon: '📋' },
    { label: 'SA-OCDFG', route: 'sa-ocdfg', icon: '🔀' },
    { label: 'Causal Explorer', route: 'causal-explorer', icon: '🔍' },
    { label: 'Lifecycle Patterns', route: 'lifecycle-patterns', icon: '🧩' }
  ];

  activeItem = 'events';

  selectItem(item: string): void {
    this.activeItem = item;
    this.itemSelected.emit(item);
  }
}
