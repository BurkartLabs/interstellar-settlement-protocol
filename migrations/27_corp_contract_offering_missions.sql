create table if not exists corp_contract_offering_missions (
  corp_id              text not null references corporations(id) on delete cascade,
  slot                 int  not null,
  mission_template_id  text not null,
  primary key (corp_id, slot)
);
