import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GraphPatternsComponent } from './graph-patterns.component';

describe('GraphPatternsComponent', () => {
  let component: GraphPatternsComponent;
  let fixture: ComponentFixture<GraphPatternsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GraphPatternsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GraphPatternsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
