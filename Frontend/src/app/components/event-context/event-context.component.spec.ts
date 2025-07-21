import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EventContextComponent } from './event-context.component';

describe('EventContextComponent', () => {
  let component: EventContextComponent;
  let fixture: ComponentFixture<EventContextComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EventContextComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(EventContextComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
