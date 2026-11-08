import { db } from '../../core/database/db';
import { GeneratedQuestionItem } from '../ai-generator/ai.service';

export class QuestionsRepository {
  async bulkInsertDraftQuestions(
    documentId: string | null,
    subjectId: string,
    items: GeneratedQuestionItem[]
  ): Promise<string[]> {
    return await db.transaction().execute(async (trx) => {
      const createdIds: string[] = [];

      for (const item of items) {
        const [q] = await trx
          .insertInto('questions')
          .values({
            document_id: documentId,
            subject_id: subjectId,
            content: item.content,
            difficulty: item.difficulty,
            explanation: item.explanation,
            source_reference: item.source_reference
          })
          .returning('id')
          .execute();

        createdIds.push(q.id);

        const options = item.options.map((opt) => ({
          question_id: q.id,
          option_label: opt.label,
          content: opt.content,
          is_correct: opt.is_correct
        }));

        await trx.insertInto('question_options').values(options).execute();
      }

      return createdIds;
    });
  }

  async getQuestionsBySubject(subjectId: string, limit = 60) {
    return await db
      .selectFrom('questions')
      .selectAll()
      .where('subject_id', '=', subjectId)
      .where('is_deleted', '=', false)
      .orderBy(db.fn('random'))
      .limit(limit)
      .execute();
  }
}
