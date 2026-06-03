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

// AI Question Generator using Gemini API
export async function generateAIQuestions(
  project: { title: string; description: string; domain: string },
  templateProfile?: { chapters?: string[]; citation?: string; font?: string },
  apiKey?: string
): Promise<Question[]> {
  const finalApiKey = apiKey || process.env.NEXT_PUBLIC_GEMINI_API_KEY;

  if (!finalApiKey) {
    console.log("No Gemini API key found, generating smart fallback questions.");
    return generateFallbackQuestions(project.title, project.description, project.domain);
  }

  const chaptersStr = templateProfile?.chapters?.join(", ") || "None extracted yet";
  
  const prompt = `You are an academic advisor. Based on the following project information and styling template guidelines, generate a list of 5 to 7 specific, highly relevant questionnaire questions (in English) to gather the necessary details from the student to generate a high-quality, comprehensive academic report.

Project Title: ${project.title}
Domain: ${project.domain}
Description: ${project.description}
Extracted Template Chapters: ${chaptersStr}

Return the output strictly as a JSON array of objects. Do not write any introduction, markdown formatting, or explain anything. Just output the raw JSON.
Each object in the array must have exactly these fields:
- "id": A unique short identifier (using lowercase alphanumeric and underscores, e.g. "dataset_source")
- "label": The question text to display to the user (e.g. "What datasets will you use, and how will they be preprocessed?")
- "type": Either "text" (for short inputs) or "textarea" (for detailed descriptions).

Ensure the questions cover the core methodology, architecture/design, implementation details, evaluation/results, and challenges of the project. Do not generate generic questions; tailor them specifically to the project's domain and description.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${finalApiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API returned status ${response.status}`);
    }

    const data = await response.json();
    const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!textResponse) {
      throw new Error("Empty response from Gemini API");
    }

    // Clean up response if it has markdown block ticks
    let cleanJson = textResponse.trim();
    if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }

    const parsedQuestions = JSON.parse(cleanJson) as Question[];
    if (Array.isArray(parsedQuestions) && parsedQuestions.length > 0) {
      return parsedQuestions;
    }
    
    throw new Error("Parsed JSON is not a valid non-empty array of questions");
  } catch (error) {
    console.error("Error generating AI questions, falling back to rule-based questions:", error);
    return generateFallbackQuestions(project.title, project.description, project.domain);
  }
}
