#!/usr/bin/env npx tsx
/**
 * Simple test to verify the test infrastructure works
 */

import { TestServer } from './test-server';

async function simple_test() {
  console.log('🧪 Simple Test Runner');
  console.log('='.repeat(60));
  
  const server = new TestServer(3456);
  
  try {
    // Start test server
    await server.start();
    console.log('✅ Test server started successfully');
    
    // Test that we can get URLs
    console.log(`📍 Server URL: ${server.getUrl('/')}`);
    console.log(`📍 Page 1 URL: ${server.getUrl('/page1')}`);
    console.log(`📍 SPA URL: ${server.getUrl('/spa')}`);
    
    console.log('\n✅ All basic tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await server.stop();
    console.log('🧹 Test server stopped');
  }
}

// Run the test
simple_test()
  .then(() => {
    console.log('\n✅ Simple test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Simple test failed:', error);
    process.exit(1);
  });