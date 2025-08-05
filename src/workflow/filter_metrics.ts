export interface FilterMetrics {
  total_pages: number;
  processed_pages: number;
  filtered_pages: number;
  filter_reasons: Record<string, number>;
  page_types: Record<string, number>;
  average_confidence: number;
}

export class FilterMetricsCollector {
  private metrics: FilterMetrics = {
    total_pages: 0,
    processed_pages: 0,
    filtered_pages: 0,
    filter_reasons: {},
    page_types: {},
    average_confidence: 0
  };
  
  private confidence_sum = 0;

  record_classification(
    url: string,
    page_type: string,
    confidence: number,
    processed: boolean,
    reason?: string
  ): void {
    this.metrics.total_pages++;
    this.confidence_sum += confidence;
    this.metrics.average_confidence = this.confidence_sum / this.metrics.total_pages;
    
    // Track page types
    this.metrics.page_types[page_type] = (this.metrics.page_types[page_type] || 0) + 1;
    
    if (processed) {
      this.metrics.processed_pages++;
    } else {
      this.metrics.filtered_pages++;
      if (reason) {
        this.metrics.filter_reasons[reason] = (this.metrics.filter_reasons[reason] || 0) + 1;
      }
    }
  }

  get_metrics(): FilterMetrics {
    return { ...this.metrics };
  }

  log_summary(): void {
    console.log('\n=== Webpage Filter Metrics ===');
    console.log(`Total pages analyzed: ${this.metrics.total_pages}`);
    console.log(`Pages processed: ${this.metrics.processed_pages} (${this.get_percentage(this.metrics.processed_pages)}%)`);
    console.log(`Pages filtered: ${this.metrics.filtered_pages} (${this.get_percentage(this.metrics.filtered_pages)}%)`);
    console.log(`Average confidence: ${this.metrics.average_confidence.toFixed(2)}`);
    
    console.log('\nPage types:');
    Object.entries(this.metrics.page_types)
      .sort(([, a], [, b]) => b - a)
      .forEach(([type, count]) => {
        console.log(`  ${type}: ${count} (${this.get_percentage(count)}%)`);
      });
    
    if (Object.keys(this.metrics.filter_reasons).length > 0) {
      console.log('\nFilter reasons:');
      Object.entries(this.metrics.filter_reasons)
        .sort(([, a], [, b]) => b - a)
        .forEach(([reason, count]) => {
          console.log(`  ${reason}: ${count}`);
        });
    }
  }

  private get_percentage(count: number): string {
    if (this.metrics.total_pages === 0) return '0';
    return ((count / this.metrics.total_pages) * 100).toFixed(1);
  }
}

// Global metrics collector instance
export const global_filter_metrics = new FilterMetricsCollector();