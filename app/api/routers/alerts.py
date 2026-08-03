"""Alerts router — CRUD + PATCH for toggling rules."""
from __future__ import annotations
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.data.database import get_db
from app.data.repositories import AlertRuleRepository
from app.data.models import AlertCondition
from app.security.dependencies import require_admin, get_current_user

router = APIRouter(prefix="/alerts", tags=["alerts"])


class AlertRuleCreate(BaseModel):
    name: str
    condition: AlertCondition
    threshold: Optional[float] = None
    camera_id: Optional[int] = None
    cooldown_minutes: int = 30


class AlertRulePatch(BaseModel):
    name: Optional[str] = None
    threshold: Optional[float] = None
    cooldown_minutes: Optional[int] = None
    is_active: Optional[bool] = None


class AlertRuleOut(BaseModel):
    id: int
    name: str
    condition: str
    threshold: Optional[float]
    camera_id: Optional[int]
    cooldown_minutes: int
    is_active: bool

    class Config:
        from_attributes = True


def _rule_out(r) -> AlertRuleOut:
    return AlertRuleOut(
        id=r.id, name=r.name,
        condition=r.condition.value if hasattr(r.condition, "value") else r.condition,
        threshold=r.threshold,
        camera_id=r.camera_id,
        cooldown_minutes=r.cooldown_minutes,
        is_active=r.is_active,
    )


@router.get("/", response_model=List[AlertRuleOut])
def list_rules(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return [_rule_out(r) for r in AlertRuleRepository(db).list_active()]


@router.post("/", status_code=201, response_model=AlertRuleOut)
def create_rule(
    body: AlertRuleCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    rule = AlertRuleRepository(db).create(
        name=body.name,
        condition=body.condition.value,
        threshold=body.threshold,
        camera_id=body.camera_id,
        cooldown_minutes=body.cooldown_minutes,
    )
    return _rule_out(rule)


@router.patch("/{rule_id}", response_model=AlertRuleOut)
def patch_rule(
    rule_id: int,
    body: AlertRulePatch,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    repo = AlertRuleRepository(db)
    rule = repo.get_by_id(rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    if body.name is not None:
        rule.name = body.name
    if body.threshold is not None:
        rule.threshold = body.threshold
    if body.cooldown_minutes is not None:
        rule.cooldown_minutes = body.cooldown_minutes
    if body.is_active is not None:
        rule.is_active = body.is_active
    db.commit()
    db.refresh(rule)
    return _rule_out(rule)


@router.delete("/{rule_id}", status_code=204)
def delete_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    if not AlertRuleRepository(db).delete(rule_id):
        raise HTTPException(status_code=404, detail="Rule not found")
