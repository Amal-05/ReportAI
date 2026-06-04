import type { Question } from "./questionnaire";

// Smart local fallback question generator based on keywords
export function generateFallbackQuestions(title: string, description: string, domain: string): Question[] {
  const content = `${title} ${description} ${domain}`.toLowerCase();
  
  const questions: Question[] = [
    { id: "problem_statement", label: "What specific problem does your project solve?", type: "textarea" },
    { id: "objectives", label: "What are the primary objectives and key contributions of your work?", type: "textarea" },
  ];

  const isAI = content.includes("dataset") || content.includes("learning") || content.includes("model") || content.includes("network") || content.includes("predict") || content.includes("classify") || content.includes("ai") || content.includes("ml") || content.includes("vision") || content.includes("nlp");
  const isHardware = content.includes("sensor") || content.includes("arduino") || content.includes("raspberry") || content.includes("iot") || content.includes("device") || content.includes("esp32") || content.includes("hardware") || content.includes("controller") || content.includes("embedded");
  const isWeb = content.includes("web") || content.includes("app") || content.includes("database") || content.includes("sql") || content.includes("mongo") || content.includes("server") || content.includes("front") || content.includes("back") || content.includes("api") || content.includes("software");

  if (isAI) {
    questions.push(
      { id: "dataset_details", label: "What dataset are you using, and what are its characteristics (size, source, features)?", type: "textarea" },
      { id: "model_architecture", label: "Describe the machine learning model architecture and training hyperparameters (learning rate, optimizer, epochs).", type: "textarea" },
      { id: "evaluation_metrics", label: "What metrics (e.g., accuracy, F1-score, recall, loss) are used to evaluate model performance?", type: "text" }
    );
  } else if (isHardware) {
    questions.push(
      { id: "hardware_architecture", label: "List the microcontrollers, sensors, actuators, and hardware modules used in your design.", type: "textarea" },
      { id: "hardware_protocol", label: "Which communication protocols (e.g., I2C, SPI, MQTT, Wi-Fi, LoRa) connect your devices?", type: "text" },
      { id: "power_control", label: "How is the circuit powered, and how do you handle noise or power constraints?", type: "textarea" }
    );
  } else if (isWeb) {
    questions.push(
      { id: "tech_stack", label: "Detail the specific tech stack used (front-end library, back-end framework, database).", type: "text" },
      { id: "software_architecture", label: "Describe the software architecture (e.g., MVC, Microservices, Client-Server) and API structure.", type: "textarea" },
      { id: "database_design", label: "Describe the database schema design, tables/collections, and any indexing strategy.", type: "textarea" }
    );
  } else {
    questions.push(
      { id: "implementation_tools", label: "What development tools, programming languages, and core library dependencies are used?", type: "textarea" },
      { id: "system_architecture", label: "Outline the high-level components and flow of data in your system.", type: "textarea" }
    );
  }

  questions.push(
    { id: "scope", label: "What is included and excluded from the scope of this project?", type: "textarea" },
    { id: "testing_methods", label: "How did you test and validate the correctness and performance of your system?", type: "textarea" }
  );

  return questions;
}

// AI Question Generator calling Backend API
export async function generateAIQuestions(
  project: { title: string; description: string; domain: string },
  templateProfile?: { chapters?: string[]; citation?: string; font?: string; spacing?: string }
): Promise<Question[]> {
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://reportai-ytsn.onrender.com/api/v1";
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (process.env.NEXT_PUBLIC_OPENAI_API_KEY) {
      headers["X-OpenAI-API-Key"] = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
    }

    const response = await fetch(`${API_URL}/generation/questions-public`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        project,
        templateProfile,
      }),
    });

    if (!response.ok) {
      throw new Error(`Backend questions generation returned status ${response.status}`);
    }

    const data = await response.json();
    if (Array.isArray(data.questions) && data.questions.length > 0) {
      return data.questions as Question[];
    }
    throw new Error("Invalid questions response from backend");
  } catch (error) {
    console.error("Error generating AI questions via backend:", error);
    return generateFallbackQuestions(project.title, project.description, project.domain);
  }
}
