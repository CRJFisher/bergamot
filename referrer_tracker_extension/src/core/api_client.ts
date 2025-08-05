// Pure functions for API communication
export const send_to_server = async (
  api_base_url: string,
  endpoint: string,
  data: any
): Promise<void> => {
  console.log(`🚀 Making request to: ${api_base_url}${endpoint}`);
  
  const response = await fetch(`${api_base_url}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Failed to send to ${endpoint}: ${response.status}`);
  }
  
  console.log(`✅ Successfully sent to ${endpoint}`);
};