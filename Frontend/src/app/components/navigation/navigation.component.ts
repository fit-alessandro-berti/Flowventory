import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-navigation',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './navigation.component.html',
  styleUrl: './navigation.component.scss'
})
export class NavigationComponent {
  menuItems = [
    { label: 'Events', route: 'events', icon: '📋' },
    { label: 'Objects', route: 'objects', icon: '📦' },
    { label: 'Analytics', route: 'analytics', icon: '📊' }
  ];

  activeItem = 'events';

  selectItem(item: string): void {
    this.activeItem = item;
  }
}
