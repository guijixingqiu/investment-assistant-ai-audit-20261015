import type {Pool,PoolClient} from "pg";
import type {AuthenticatedResearchActor} from "./domain.js";
import type {ResearchQuestion} from "../../../../packages/contracts/src/researchQuestions.js";
import {operatingModelFingerprint} from "../../../../packages/contracts/src/researchOperatingModel.js";
/** Earliest append-only context containing the question is its opening event, even after later model saves. */
export async function bindQuestionOpeningTimes(pool:Pick<Pool|PoolClient,"query">,actor:AuthenticatedResearchActor,questions:ResearchQuestion[],cutoff:string):Promise<void> {
  const first=questions[0];if(!first)return;
  const owner=questions.filter(q=>q.origin==="owner_question");
  if(owner.length){
    const rows=await pool.query<{question_id:string;opened_at:string|Date}>(`select q->>'questionId' as question_id,min(c.created_at) as opened_at from research_context_snapshots c cross join lateral jsonb_array_elements(coalesce(c.context_payload->'operatingModel'->'researchQuestionDrafts','[]'::jsonb)) q where c.candidate_membership_id=$1 and c.captured_membership_version=$2 and c.selected_symbol=$3 and c.actor_type=$4 and c.actor_id=$5 and c.created_at < $6::timestamptz + interval '1 millisecond' group by q->>'questionId'`,[first.membershipId,first.membershipVersion,first.symbol,actor.actorType,actor.actorId,cutoff]);
    for(const row of rows.rows){const id=operatingModelFingerprint({symbol:first.symbol,membershipId:first.membershipId,membershipVersion:first.membershipVersion,id:row.question_id});const question=owner.find(q=>q.questionId===id);if(question)question.openedAt=new Date(row.opened_at).toISOString();}
  }
  const scenarios=questions.filter(q=>q.origin==="scenario_input_gap");if(!scenarios.length)return;
  const contexts=await pool.query<{created_at:string|Date;context_payload:{operatingModel?:{scenarios?:Array<{name:string;period:{start:string;end:string};inputs:Record<string,{origin:string}>}>}}}>(`select created_at,context_payload from research_context_snapshots where candidate_membership_id=$1 and captured_membership_version=$2 and selected_symbol=$3 and actor_type=$4 and actor_id=$5 and created_at<=$6 order by created_at,id`,[first.membershipId,first.membershipVersion,first.symbol,actor.actorType,actor.actorId,cutoff]);
  for(const row of contexts.rows){for(const base of row.context_payload?.operatingModel?.scenarios??[]){if(base.name!=="base"||!Object.values(base.inputs??{}).some(input=>input.origin!=="unknown"))continue;const id=operatingModelFingerprint({symbol:first.symbol,membershipId:first.membershipId,membershipVersion:first.membershipVersion,origin:"scenario_input_gap",targetMetric:"normalized_profit",test:null,scope:`base:${base.period.start}:${base.period.end}`});const match=scenarios.find(q=>q.questionId===id);if(match&&new Date(row.created_at).toISOString()<match.openedAt)match.openedAt=new Date(row.created_at).toISOString();}}
}
